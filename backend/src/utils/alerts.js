const db = require('../db/db');
const config = require('../config');

async function raiseAlert({ containerId, type, message }) {
  db.prepare(`INSERT INTO alerts (container_id, type, message) VALUES (?, ?, ?)`)
    .run(containerId || null, type, message);

  if (config.alerts.webhookUrl) {
    try {
      await fetch(config.alerts.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ containerId, type, message, ts: new Date().toISOString() }),
      });
    } catch (err) {
      console.error('[alerts] webhook delivery failed:', err.message);
    }
  }
}

module.exports = { raiseAlert };
