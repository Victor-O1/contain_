const express = require('express');
const db = require('../db/db');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const templates = db.prepare('SELECT * FROM templates').all();
  res.json(templates);
});

// Admins can add custom templates (e.g., internal golden images)
router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { key, label, image, description, default_cmd, exposed_port } = req.body;
  if (!key || !label || !image) return res.status(400).json({ error: 'key, label, image required' });
  db.prepare(`INSERT INTO templates (key, label, image, description, default_cmd, exposed_port)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(key, label, image, description || null, default_cmd || null, exposed_port || null);
  res.status(201).json({ ok: true });
});

module.exports = router;
