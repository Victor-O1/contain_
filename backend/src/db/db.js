const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const dir = path.dirname(config.dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',        -- 'admin' | 'user'
  max_containers INTEGER NOT NULL,
  cpu_limit REAL NOT NULL,
  memory_limit_mb INTEGER NOT NULL,
  is_guest INTEGER NOT NULL DEFAULT 0,      -- 1 for ephemeral public-demo accounts
  expires_at TEXT,                          -- guest accounts auto-expire
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hosts (
  id TEXT PRIMARY KEY,               -- e.g. 'local', 'worker-1'
  label TEXT NOT NULL,
  connection TEXT NOT NULL,          -- socket path or tcp://host:port
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS containers (
  id TEXT PRIMARY KEY,             -- our internal id (uuid)
  docker_id TEXT,                  -- docker container id (set after create)
  host_id TEXT NOT NULL DEFAULT 'local',   -- which Docker host this was scheduled on
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  template_key TEXT NOT NULL,
  image TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'creating',  -- creating|running|stopped|error|destroyed
  cpu_limit REAL NOT NULL,
  memory_limit_mb INTEGER NOT NULL,
  volume_name TEXT,
  proxy_subdomain TEXT,
  exposed_port INTEGER,
  host_port INTEGER,
  last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS templates (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  image TEXT NOT NULL,
  description TEXT,
  default_cmd TEXT,
  exposed_port INTEGER
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  action TEXT NOT NULL,          -- e.g. container.create, container.exec, container.delete
  target TEXT,                   -- container id / other target
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exec_sessions (
  id TEXT PRIMARY KEY,
  container_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  command_log TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS metrics_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id TEXT NOT NULL,
  cpu_percent REAL,
  mem_percent REAL,
  mem_usage_mb REAL,
  net_rx_bytes INTEGER,
  net_tx_bytes INTEGER,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_metrics_container_time ON metrics_history(container_id, recorded_at);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id TEXT,
  type TEXT NOT NULL,           -- cpu|memory|crash
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Seed default templates if empty
const templateCount = db.prepare('SELECT COUNT(*) AS c FROM templates').get().c;
if (templateCount === 0) {
  const insert = db.prepare(`INSERT INTO templates (key, label, image, description, default_cmd, exposed_port)
    VALUES (@key, @label, @image, @description, @default_cmd, @exposed_port)`);
  const seedTx = db.transaction((rows) => rows.forEach((r) => insert.run(r)));
  seedTx([
    { key: 'ubuntu-base', label: 'Ubuntu 24.04 (bare)', image: 'ubuntu:24.04', description: 'Vanilla Ubuntu sandbox with bash.', default_cmd: '/bin/bash', exposed_port: null },
    { key: 'python-datascience', label: 'Python Data Science', image: 'jupyter/scipy-notebook:latest', description: 'Python + Jupyter + numpy/pandas/scipy.', default_cmd: null, exposed_port: 8888 },
    { key: 'node-dev', label: 'Node.js Dev Box', image: 'node:20-bullseye', description: 'Node 20 + npm, bash shell.', default_cmd: '/bin/bash', exposed_port: 3000 },
    { key: 'code-server', label: 'VS Code (browser)', image: 'codercom/code-server:latest', description: 'Full VS Code in the browser.', default_cmd: null, exposed_port: 8080 },
  ]);
}

// Seed the local Docker host so the multi-host pool always has at least one entry.
// Keeps the connection string in sync with config.dockerSocket on every boot, so a
// platform-detection fix (e.g. Windows named pipe vs Linux socket) self-heals an
// existing database instead of requiring a manual reset.
const localHost = db.prepare(`SELECT * FROM hosts WHERE id = 'local'`).get();
if (!localHost) {
  db.prepare(`INSERT INTO hosts (id, label, connection, enabled) VALUES ('local', 'Local Docker Engine', ?, 1)`)
    .run(config.dockerSocket);
} else if (localHost.connection !== config.dockerSocket) {
  db.prepare(`UPDATE hosts SET connection = ? WHERE id = 'local'`).run(config.dockerSocket);
  console.log(`[db] local host connection updated: ${localHost.connection} -> ${config.dockerSocket}`);
}

// No auth: seed the one local operator account everything runs as. See authMiddleware.js.
const localUser = db.prepare(`SELECT id FROM users WHERE id = 'local'`).get();
if (!localUser) {
  db.prepare(`INSERT INTO users (id, email, password_hash, role, max_containers, cpu_limit, memory_limit_mb)
              VALUES ('local', 'local@localhost', '', 'admin', 999, ?, ?)`)
    .run(config.quotas.defaultCpuLimit, config.quotas.defaultMemoryLimitMb);
}

module.exports = db;
