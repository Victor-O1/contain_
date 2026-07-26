const express = require('express');
const db = require('../db/db');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const hostPool = require('../docker/hostPool');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// --- Multi-host orchestration: register/enable/disable Docker Engine hosts sandboxes can be scheduled onto ---
router.get('/hosts', (req, res) => {
  const hosts = hostPool.listHosts();
  const counts = db.prepare(
    `SELECT host_id, COUNT(*) AS c FROM containers WHERE status = 'running' GROUP BY host_id`
  ).all();
  const countMap = Object.fromEntries(counts.map((r) => [r.host_id, r.c]));
  res.json(hosts.map((h) => ({ ...h, activeContainers: countMap[h.id] || 0 })));
});

router.post('/hosts', (req, res) => {
  const { id, label, connection } = req.body;
  if (!id || !label || !connection) return res.status(400).json({ error: 'id, label, connection required' });
  try {
    hostPool.addHost({ id, label, connection });
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/hosts/:id', (req, res) => {
  hostPool.setHostEnabled(req.params.id, !!req.body.enabled);
  res.json({ ok: true });
});

router.get('/audit', (req, res) => {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 500').all();
  res.json(rows);
});

router.get('/alerts', (req, res) => {
  const rows = db.prepare('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 200').all();
  res.json(rows);
});

router.get('/stats/overview', (req, res) => {
  const activeContainers = db.prepare(`SELECT COUNT(*) c FROM containers WHERE status = 'running'`).get().c;
  const totalContainersEver = db.prepare('SELECT COUNT(*) c FROM containers').get().c;
  res.json({ activeContainers, totalContainersEver });
});

module.exports = router;
