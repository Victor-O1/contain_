const { WebSocketServer } = require('ws');
const url = require('url');
const db = require('../db/db');
const { handleExecConnection } = require('./execHandler');
const { handleStatsConnection } = require('./statsHandler');

/**
 * Routes:
 *   /ws/exec/:containerId    -> interactive terminal
 *   /ws/stats/:containerId   -> live resource stats
 * No auth token required — single-user local tool, see authMiddleware.js.
 */
function attachWebSocketServer(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = url.parse(req.url, true);
    const parts = pathname.split('/').filter(Boolean); // ['ws', 'exec'|'stats', ':id']

    if (parts[0] !== 'ws' || parts.length !== 3) {
      socket.destroy();
      return;
    }

    const [, kind, containerId] = parts;
    const container = db.prepare('SELECT * FROM containers WHERE id = ?').get(containerId);
    if (!container) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const user = db.prepare(`SELECT * FROM users WHERE id = 'local'`).get();

    wss.handleUpgrade(req, socket, head, (ws) => {
      if (kind === 'exec') handleExecConnection(ws, { container, user });
      else if (kind === 'stats') handleStatsConnection(ws, { container });
      else ws.close();
    });
  });

  return wss;
}

module.exports = { attachWebSocketServer };
