const { v4: uuid } = require('uuid');
const db = require('../db/db');
const dockerService = require('../docker/dockerService');
const { logAction } = require('../utils/audit');

/**
 * Bridges a browser WebSocket to `docker exec -it` for a given container.
 * Protocol (JSON control messages mixed with raw text for terminal I/O):
 *   client -> server: { type: 'resize', cols, rows }
 *   client -> server: raw string  => sent to the container's stdin
 *   server -> client: raw string  => container stdout/stderr
 */
async function handleExecConnection(ws, { container, user }) {
  if (container.status !== 'running' || !container.docker_id) {
    ws.send(JSON.stringify({ type: 'error', message: 'Container is not running' }));
    return ws.close();
  }

  const sessionId = uuid();
  db.prepare(`INSERT INTO exec_sessions (id, container_id, user_id) VALUES (?, ?, ?)`)
    .run(sessionId, container.id, user.id);
  logAction({ userId: user.id, action: 'container.exec_start', target: container.id, detail: { sessionId } });

  let execHandle;
  try {
    const { exec, stream } = await dockerService.execIntoSandbox(container.docker_id, {
      cmd: ['/bin/bash'],
      cols: 80,
      rows: 24,
      hostId: container.host_id,
    });
    execHandle = exec;

    // Container -> browser
    stream.on('data', (chunk) => {
      if (ws.readyState === ws.OPEN) ws.send(chunk.toString('utf8'));
    });
    stream.on('end', () => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'exit' }));
      ws.close();
    });

    // Browser -> container
    ws.on('message', (data) => {
      const text = data.toString();
      // control messages are small JSON blobs starting with '{'
      if (text.startsWith('{"type":"resize"')) {
        try {
          const { cols, rows } = JSON.parse(text);
          dockerService.resizeExec(execHandle, { cols, rows });
          return;
        } catch { /* fallthrough - treat as raw input */ }
      }
      stream.write(text);
      appendCommandLog(sessionId, text);
      touchLastActive(container.id);
    });

    ws.on('close', () => {
      try { stream.end(); } catch { /* already closed */ }
      db.prepare(`UPDATE exec_sessions SET ended_at = datetime('now') WHERE id = ?`).run(sessionId);
      logAction({ userId: user.id, action: 'container.exec_end', target: container.id, detail: { sessionId } });
    });
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
    ws.close();
  }
}

// Lightweight session recording: buffer keystrokes, flush periodically to keep writes cheap.
const buffers = new Map();
function appendCommandLog(sessionId, chunk) {
  const buf = (buffers.get(sessionId) || '') + chunk;
  buffers.set(sessionId, buf);
  if (buf.length > 4000) flush(sessionId);
}
function flush(sessionId) {
  const buf = buffers.get(sessionId);
  if (!buf) return;
  db.prepare(`UPDATE exec_sessions SET command_log = command_log || ? WHERE id = ?`).run(buf, sessionId);
  buffers.set(sessionId, '');
}
setInterval(() => { for (const id of buffers.keys()) flush(id); }, 5000).unref();

function touchLastActive(containerId) {
  db.prepare(`UPDATE containers SET last_active_at = datetime('now') WHERE id = ?`).run(containerId);
}

module.exports = { handleExecConnection };
