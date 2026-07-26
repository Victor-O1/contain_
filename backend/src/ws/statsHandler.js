const dockerService = require('../docker/dockerService');
const config = require('../config');
const db = require('../db/db');
const { raiseAlert } = require('../utils/alerts');

/**
 * Streams live CPU/memory/network/uptime stats for a container over WebSocket
 * by tapping Docker's native stats stream (avoids polling overhead).
 */
async function handleStatsConnection(ws, { container }) {
  if (container.status !== 'running' || !container.docker_id) {
    ws.send(JSON.stringify({ type: 'error', message: 'Container is not running' }));
    return ws.close();
  }

  let dockerStream;
  try {
    dockerStream = await dockerService.getStatsStream(container.docker_id, container.host_id);
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
    return ws.close();
  }

  let buffer = '';
  dockerStream.on('data', async (chunk) => {
    buffer += chunk.toString('utf8');
    let boundary;
    // Docker streams newline-delimited JSON objects
    while ((boundary = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      if (!line.trim()) continue;
      try {
        const raw = JSON.parse(line);
        const summary = dockerService.computeStatSummary(raw);
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'stats', ...summary }));
        }
        checkThresholds(container, summary);
        recordSample(container.id, summary);
      } catch { /* partial line, ignore */ }
    }
  });

  dockerStream.on('error', (err) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'error', message: err.message }));
  });

  ws.on('close', () => {
    try { dockerStream.destroy(); } catch { /* already closed */ }
  });
}

// Docker emits a stats tick roughly every second; sampling down to ~10s keeps
// metrics_history useful for trend charts without growing unbounded.
let lastSampleAt = new Map();
function recordSample(containerId, summary) {
  const now = Date.now();
  const last = lastSampleAt.get(containerId) || 0;
  if (now - last < 10_000) return;
  lastSampleAt.set(containerId, now);
  db.prepare(
    `INSERT INTO metrics_history (container_id, cpu_percent, mem_percent, mem_usage_mb, net_rx_bytes, net_tx_bytes)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(containerId, summary.cpuPercent, summary.memPercent, summary.memUsageMb, summary.netRxBytes, summary.netTxBytes);
}

let lastAlertAt = new Map();
function checkThresholds(container, summary) {
  const now = Date.now();
  const cooldownMs = 60_000;
  const last = lastAlertAt.get(container.id) || 0;
  if (now - last < cooldownMs) return;

  if (summary.cpuPercent >= config.alerts.cpuThreshold) {
    raiseAlert({ containerId: container.id, type: 'cpu', message: `CPU at ${summary.cpuPercent}% (threshold ${config.alerts.cpuThreshold}%)` });
    lastAlertAt.set(container.id, now);
  } else if (summary.memPercent >= config.alerts.memThreshold) {
    raiseAlert({ containerId: container.id, type: 'memory', message: `Memory at ${summary.memPercent}% (threshold ${config.alerts.memThreshold}%)` });
    lastAlertAt.set(container.id, now);
  }
}

module.exports = { handleStatsConnection };
