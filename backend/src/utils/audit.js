const db = require('../db/db');

function logAction({ userId, action, target, detail, ip }) {
  db.prepare(
    `INSERT INTO audit_log (user_id, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)`
  ).run(userId || null, action, target || null, detail ? JSON.stringify(detail) : null, ip || null);
}

module.exports = { logAction };
