require('dotenv').config();

module.exports = {
  port: process.env.PORT || 4000,
  // Docker Desktop on Windows exposes a named pipe, not a Unix socket.
  // Linux/macOS (including WSL2 running the backend itself) use the socket file.
  dockerSocket: process.env.DOCKER_SOCKET || (process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock'),
  dbPath: process.env.DB_PATH || './data/platform.db',

  quotas: {
    defaultMaxContainers: parseInt(process.env.DEFAULT_MAX_CONTAINERS || '3', 10),
    defaultCpuLimit: parseFloat(process.env.DEFAULT_CPU_LIMIT || '1'),
    defaultMemoryLimitMb: parseInt(process.env.DEFAULT_MEMORY_LIMIT_MB || '512', 10),
  },

  idle: {
    timeoutMinutes: parseInt(process.env.IDLE_TIMEOUT_MINUTES || '30', 10),
    checkIntervalMinutes: parseInt(process.env.IDLE_CHECK_INTERVAL_MINUTES || '5', 10),
  },

  proxy: {
    enabled: (process.env.PROXY_ENABLED || 'true') === 'true',
    baseDomain: process.env.BASE_DOMAIN || 'sandboxes.local',
  },

  alerts: {
    webhookUrl: process.env.ALERT_WEBHOOK_URL || '',
    cpuThreshold: parseFloat(process.env.CPU_ALERT_THRESHOLD_PERCENT || '90'),
    memThreshold: parseFloat(process.env.MEM_ALERT_THRESHOLD_PERCENT || '90'),
  },

  security: {
    // Point at a gVisor ('runsc') or Kata ('kata') runtime already registered with
    // the Docker daemon for stronger sandbox isolation than default runc. Leave
    // unset to use the daemon default.
    runtime: process.env.SANDBOX_RUNTIME || '',
    seccompProfilePath: process.env.SECCOMP_PROFILE_PATH || '',
    apparmorProfile: process.env.APPARMOR_PROFILE || '',
  },

  ci: {
    apiKey: process.env.CI_API_KEY || '',
  },

  compiler: {
    timeoutMs: parseInt(process.env.COMPILER_TIMEOUT_MS || '15000', 10),
    cpuLimit: parseFloat(process.env.COMPILER_CPU_LIMIT || '1'),
    memoryLimitMb: parseInt(process.env.COMPILER_MEMORY_LIMIT_MB || '256', 10),
    maxCodeLength: parseInt(process.env.COMPILER_MAX_CODE_LENGTH || '20000', 10),
    runsPerHour: parseInt(process.env.COMPILER_RUNS_PER_HOUR || '60', 10),
  },
};
