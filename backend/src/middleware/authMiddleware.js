const db = require('../db/db');

// Authentication removed: this runs as a single-user local tool. Every request
// is treated as the one local operator account, auto-created on first boot
// (see db.js seeding). No login/signup, no tokens.
function requireAuth(req, res, next) {
  const user = db.prepare(`SELECT * FROM users WHERE id = 'local'`).get();
  if (!user) return res.status(500).json({ error: 'Local operator account missing — check db seeding' });
  req.user = user;
  next();
}

// Single-user mode: the local account is always treated as admin.
function requireAdmin(req, res, next) {
  next();
}

// No ownership concept in single-user mode — any request can act on any container.
function requireContainerOwnership(req, res, next) {
  const container = db.prepare('SELECT * FROM containers WHERE id = ?').get(req.params.id);
  if (!container) return res.status(404).json({ error: 'Container not found' });
  req.container = container;
  next();
}

module.exports = { requireAuth, requireAdmin, requireContainerOwnership };
