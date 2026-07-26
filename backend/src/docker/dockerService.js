const config = require('../config');
const hostPool = require('./hostPool');
const tar = require('tar-stream');
const { PassThrough } = require('stream');

const PLATFORM_LABEL = 'io.platform.managed';
const NETWORK_NAME = 'platform_sandbox_net';

// Default client kept for callers that don't care about multi-host scheduling
// (e.g. one-off admin scripts). Route handlers should pass an explicit hostId.
const docker = hostPool.getClientForHost('local');

function clientFor(hostId) {
  return hostId ? hostPool.getClientForHost(hostId) : docker;
}

/** Ensure the isolated bridge network for sandboxes exists (network isolation feature). */
async function ensureNetwork(hostId) {
  const d = clientFor(hostId);
  const networks = await d.listNetworks({ filters: { name: [NETWORK_NAME] } });
  if (networks.length === 0) {
    await d.createNetwork({
      Name: NETWORK_NAME,
      Driver: 'bridge',
      Internal: false,
      Labels: { [PLATFORM_LABEL]: 'true' },
    });
  }
  return NETWORK_NAME;
}

/** Ensure a persistent named volume exists for a container's /workspace, so state survives restarts. */
async function ensureVolume(volumeName, hostId) {
  const d = clientFor(hostId);
  try {
    await d.getVolume(volumeName).inspect();
  } catch {
    await d.createVolume({ Name: volumeName, Labels: { [PLATFORM_LABEL]: 'true' } });
  }
  return volumeName;
}

/**
 * Create + start a new sandbox container with CPU/memory limits, an isolated network,
 * a persistent volume, and (optionally) an exposed port bound to a random host port.
 */
async function createSandbox({ id, image, cpuLimit, memoryLimitMb, exposedPort, cmd, hostId }) {
  const d = clientFor(hostId);
  await ensureNetwork(hostId);
  const volumeName = `vol_${id}`;
  await ensureVolume(volumeName, hostId);

  // Pull image if not present locally
  await pullImageIfMissing(image, hostId);

  const exposedPortsConfig = {};
  const portBindings = {};
  if (exposedPort) {
    const key = `${exposedPort}/tcp`;
    exposedPortsConfig[key] = {};
    portBindings[key] = [{ HostPort: '' }]; // '' = docker picks a free host port
  }

  // --- Security hardening ---
  // SANDBOX_RUNTIME can point at a gVisor ('runsc') or Kata ('kata') runtime that's
  // already registered with the target Docker daemon, for stronger isolation than
  // default runc. Falls back to runc (Docker's default) when unset.
  const securityOpt = ['no-new-privileges'];
  if (config.security.seccompProfilePath) {
    securityOpt.push(`seccomp=${config.security.seccompProfilePath}`);
  }
  if (config.security.apparmorProfile) {
    securityOpt.push(`apparmor=${config.security.apparmorProfile}`);
  }

  const container = await d.createContainer({
    name: `sandbox_${id}`,
    Image: image,
    Cmd: cmd || undefined,
    Tty: true,
    OpenStdin: true,
    Labels: { [PLATFORM_LABEL]: 'true', 'io.platform.sandbox_id': id },
    ExposedPorts: exposedPortsConfig,
    HostConfig: {
      // --- Resource management / process isolation ---
      NanoCpus: Math.round(cpuLimit * 1e9),           // CPU limit
      Memory: memoryLimitMb * 1024 * 1024,             // Memory limit (bytes)
      MemorySwap: memoryLimitMb * 1024 * 1024,         // disallow swap beyond limit
      PidsLimit: 256,                                  // fork-bomb / process isolation guard
      SecurityOpt: securityOpt,
      CapDrop: ['ALL'],
      CapAdd: ['CHOWN', 'SETUID', 'SETGID', 'DAC_OVERRIDE'],
      ReadonlyRootfs: false,
      Binds: [`${volumeName}:/workspace`],
      PortBindings: exposedPort ? portBindings : undefined,
      NetworkMode: NETWORK_NAME,
      RestartPolicy: { Name: 'unless-stopped' },
      Runtime: config.security.runtime || undefined,  // 'runsc' (gVisor) / 'kata-runtime', or unset for default runc
    },
  });

  await container.start();
  const info = await container.inspect();

  let hostPort = null;
  if (exposedPort) {
    const bindings = info.NetworkSettings.Ports[`${exposedPort}/tcp`];
    hostPort = bindings && bindings[0] ? parseInt(bindings[0].HostPort, 10) : null;
  }

  return { dockerId: container.id, volumeName, hostPort };
}

async function pullImageIfMissing(image, hostId) {
  const d = clientFor(hostId);
  const images = await d.listImages();
  const exists = images.some((img) => (img.RepoTags || []).includes(image));
  if (exists) return;

  await new Promise((resolve, reject) => {
    d.pull(image, (err, stream) => {
      if (err) return reject(err);
      d.modem.followProgress(stream, (err2) => (err2 ? reject(err2) : resolve()));
    });
  });
}

async function stopSandbox(dockerId, hostId) {
  const container = clientFor(hostId).getContainer(dockerId);
  try {
    await container.stop({ t: 5 });
  } catch (err) {
    if (err.statusCode !== 304 && err.statusCode !== 404) throw err; // 304 = already stopped
  }
}

async function startSandbox(dockerId, hostId) {
  const container = clientFor(hostId).getContainer(dockerId);
  await container.start();
}

async function removeSandbox(dockerId, { removeVolume = false, volumeName, hostId } = {}) {
  const d = clientFor(hostId);
  const container = d.getContainer(dockerId);
  try {
    await container.remove({ force: true });
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }
  if (removeVolume && volumeName) {
    try {
      await d.getVolume(volumeName).remove();
    } catch { /* ignore */ }
  }
}

async function restartSandbox(dockerId, hostId) {
  const container = clientFor(hostId).getContainer(dockerId);
  await container.restart();
}

async function inspectSandbox(dockerId, hostId) {
  const container = clientFor(hostId).getContainer(dockerId);
  return container.inspect();
}

/** Commit a running container to a new image -> snapshot feature (save environment state). */
async function snapshotSandbox(dockerId, repoTag, hostId) {
  const container = clientFor(hostId).getContainer(dockerId);
  const image = await container.commit({ repo: repoTag });
  return image;
}

/** One-shot resource stats (CPU %, mem %, net I/O) - used for REST polling fallback. */
async function getStatsOnce(dockerId, hostId) {
  const container = clientFor(hostId).getContainer(dockerId);
  const stats = await container.stats({ stream: false });
  return computeStatSummary(stats);
}

/** Streaming stats - used by the WebSocket stats handler for real-time monitoring. */
function getStatsStream(dockerId, hostId) {
  const container = clientFor(hostId).getContainer(dockerId);
  return container.stats({ stream: true });
}

function computeStatSummary(stats) {
  let cpuPercent = 0;
  try {
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const sysDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuCount = stats.cpu_stats.online_cpus || (stats.cpu_stats.cpu_usage.percpu_usage || []).length || 1;
    if (sysDelta > 0 && cpuDelta > 0) {
      cpuPercent = (cpuDelta / sysDelta) * cpuCount * 100;
    }
  } catch { /* stats format can vary transiently */ }

  const memUsage = stats.memory_stats.usage || 0;
  const memLimit = stats.memory_stats.limit || 1;
  const memPercent = (memUsage / memLimit) * 100;

  let rx = 0, tx = 0;
  if (stats.networks) {
    Object.values(stats.networks).forEach((n) => { rx += n.rx_bytes || 0; tx += n.tx_bytes || 0; });
  }

  return {
    cpuPercent: Number(cpuPercent.toFixed(2)),
    memUsageMb: Number((memUsage / 1024 / 1024).toFixed(1)),
    memLimitMb: Number((memLimit / 1024 / 1024).toFixed(1)),
    memPercent: Number(memPercent.toFixed(2)),
    netRxBytes: rx,
    netTxBytes: tx,
    ts: Date.now(),
  };
}

/** Exec into a running container and return a raw duplex stream for the WebSocket bridge. */
async function execIntoSandbox(dockerId, { cmd = ['/bin/bash'], cols = 80, rows = 24, hostId } = {}) {
  const container = clientFor(hostId).getContainer(dockerId);
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    Env: ['TERM=xterm-256color'],
  });
  const stream = await exec.start({ hijack: true, stdin: true, Tty: true });
  await exec.resize({ h: rows, w: cols }).catch(() => {});
  return { exec, stream };
}

async function resizeExec(exec, { cols, rows }) {
  try { await exec.resize({ h: rows, w: cols }); } catch { /* container may have exited */ }
}

/** Runs a one-off command inside the container and returns its combined stdout/stderr (used by the file manager for ls/mkdir/rm/mv). */
async function runCommand(dockerId, cmd, hostId) {
  const container = clientFor(hostId).getContainer(dockerId);
  const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
  const stream = await exec.start({ hijack: true });
  return new Promise((resolve, reject) => {
    let output = '';
    stream.on('data', (chunk) => { output += chunk.toString('utf8'); });
    stream.on('end', async () => {
      const info = await exec.inspect();
      resolve({ output: output.replace(/[\x00-\x08]/g, ''), exitCode: info.ExitCode });
    });
    stream.on('error', reject);
  });
}

/** Downloads a path from the container as a tar stream (File Manager: download). */
function getArchive(dockerId, path, hostId) {
  const container = clientFor(hostId).getContainer(dockerId);
  return container.getArchive({ path });
}

/** Uploads a tar stream into a directory inside the container (File Manager: upload). */
function putArchive(dockerId, tarStream, targetPath, hostId) {
  const container = clientFor(hostId).getContainer(dockerId);
  return container.putArchive(tarStream, { path: targetPath });
}

/**
 * CI/CD integration: spins up a throwaway container, runs a command to completion,
 * captures its logs, and removes it — the building block for ephemeral pipeline jobs
 * (e.g. triggered from a GitHub Actions step via the /api/ci/run endpoint).
 */
async function runEphemeralJob({ image, cmd, cpuLimit = 1, memoryLimitMb = 512, timeoutMs = 120000, hostId }) {
  const d = clientFor(hostId);
  await pullImageIfMissing(image, hostId);

  const container = await d.createContainer({
    Image: image,
    Cmd: cmd,
    Labels: { [PLATFORM_LABEL]: 'true', 'io.platform.job': 'true' },
    HostConfig: {
      NanoCpus: Math.round(cpuLimit * 1e9),
      Memory: memoryLimitMb * 1024 * 1024,
      PidsLimit: 256,
      AutoRemove: false,
      NetworkMode: 'bridge',
    },
  });

  await container.start();

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Job timed out')), timeoutMs)
  );
  const wait = container.wait();

  let result;
  try {
    result = await Promise.race([wait, timeout]);
  } catch (err) {
    await container.remove({ force: true }).catch(() => {});
    throw err;
  }

  const logs = await container.logs({ stdout: true, stderr: true, follow: false });
  await container.remove({ force: true }).catch(() => {});

  return { exitCode: result.StatusCode, logs: logs.toString('utf8') };
}

/**
 * Online compiler: runs a snippet of source code to completion inside a fresh,
 * network-isolated container and returns stdout/stderr/exit code.
 *
 * Unlike runEphemeralJob (which just runs a fixed Cmd), this needs to get the
 * submitted source *into* the container first — so it starts the container idling
 * (`sleep`), uploads the code via putArchive, then execs the build/run command with
 * a hard timeout, killing the container if it overruns (guards against infinite loops).
 * NetworkMode 'none' means arbitrary submitted code can't be used to exfiltrate data
 * or reach other hosts.
 */
async function runCodeSnippet({ image, filename, code, cmd, stdin, cpuLimit = 1, memoryLimitMb = 256, timeoutMs = 15000, hostId }) {
  const d = clientFor(hostId);
  await pullImageIfMissing(image, hostId);

  const container = await d.createContainer({
    Image: image,
    Cmd: ['sleep', String(Math.ceil(timeoutMs / 1000) + 30)],
    Labels: { [PLATFORM_LABEL]: 'true', 'io.platform.compiler_job': 'true' },
    WorkingDir: '/code',
    HostConfig: {
      NanoCpus: Math.round(cpuLimit * 1e9),
      Memory: memoryLimitMb * 1024 * 1024,
      MemorySwap: memoryLimitMb * 1024 * 1024,
      PidsLimit: 128,
      SecurityOpt: ['no-new-privileges'],
      CapDrop: ['ALL'],
      NetworkMode: 'none', // no network access for arbitrary user-submitted code
      AutoRemove: false,
    },
  });

  try {
    await container.start();

    const mkdir = await container.exec({ Cmd: ['mkdir', '-p', '/code'], AttachStdout: true, AttachStderr: true });
    await runAndWait(mkdir);

    const pack = tar.pack();
    pack.entry({ name: filename }, code);
    pack.finalize();
    await container.putArchive(pack, { path: '/code' });

    return await execWithTimeout(d, container, ['sh', '-c', cmd], { timeoutMs, stdin });
  } finally {
    await container.remove({ force: true }).catch(() => {});
  }
}

function runAndWait(exec) {
  return exec.start({ hijack: true }).then(
    (stream) => new Promise((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('error', reject);
      stream.resume();
    })
  );
}

/** Execs a command with stdin support, demuxed stdout/stderr, and a hard wall-clock timeout. */
async function execWithTimeout(dockerClient, container, cmd, { timeoutMs, stdin }) {
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });
  const stream = await exec.start({ hijack: true, stdin: true });

  let stdout = '';
  let stderr = '';
  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  dockerClient.modem.demuxStream(stream, stdoutStream, stderrStream);
  stdoutStream.on('data', (c) => { stdout += c.toString('utf8'); });
  stderrStream.on('data', (c) => { stderr += c.toString('utf8'); });

  if (stdin) stream.write(stdin);
  stream.end();

  const streamEnded = new Promise((resolve) => stream.on('end', resolve));
  let timedOut = false;

  const timeout = new Promise((resolve) => {
    setTimeout(() => { timedOut = true; resolve(); }, timeoutMs);
  });

  await Promise.race([streamEnded, timeout]);

  if (timedOut) {
    await container.kill().catch(() => {});
    return { stdout, stderr: stderr + '\n[terminated: time limit exceeded]', exitCode: null, timedOut: true };
  }

  const info = await exec.inspect();
  // Cap output size returned to the client — runaway prints shouldn't blow up the response.
  const MAX_LEN = 200_000;
  return {
    stdout: stdout.length > MAX_LEN ? stdout.slice(0, MAX_LEN) + '\n[output truncated]' : stdout,
    stderr: stderr.length > MAX_LEN ? stderr.slice(0, MAX_LEN) + '\n[output truncated]' : stderr,
    exitCode: info.ExitCode,
    timedOut: false,
  };
}

module.exports = {
  docker,
  clientFor,
  createSandbox,
  stopSandbox,
  startSandbox,
  removeSandbox,
  restartSandbox,
  inspectSandbox,
  snapshotSandbox,
  getStatsOnce,
  getStatsStream,
  computeStatSummary,
  execIntoSandbox,
  resizeExec,
  runCommand,
  getArchive,
  putArchive,
  runEphemeralJob,
  runCodeSnippet,
  pullImageIfMissing,
};
