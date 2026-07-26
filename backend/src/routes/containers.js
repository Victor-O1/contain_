const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db/db');
const config = require('../config');
const { requireAuth, requireContainerOwnership } = require('../middleware/authMiddleware');
const dockerService = require('../docker/dockerService');
const hostPool = require('../docker/hostPool');
const proxyManager = require('../utils/proxyManager');
const { logAction } = require('../utils/audit');

const router = express.Router();

// --- List my containers (admins can see all via ?all=true) ---
router.get('/', requireAuth, (req, res) => {
  const rows = req.user.role === 'admin' && req.query.all === 'true'
    ? db.prepare('SELECT * FROM containers WHERE status != ? ORDER BY created_at DESC').all('destroyed')
    : db.prepare('SELECT * FROM containers WHERE user_id = ? AND status != ? ORDER BY created_at DESC')
        .all(req.user.id, 'destroyed');
  res.json(rows.map(serialize));
});

router.get('/:id', requireAuth, requireContainerOwnership, (req, res) => {
  res.json(serialize(req.container));
});

// --- Create a new sandbox from a template, enforcing per-user quotas ---
router.post('/', requireAuth, async (req, res) => {
  const { templateKey, name } = req.body;
  const template = db.prepare('SELECT * FROM templates WHERE key = ?').get(templateKey);
  if (!template) return res.status(400).json({ error: 'Unknown template' });

  const activeCount = db.prepare(
    `SELECT COUNT(*) AS c FROM containers WHERE user_id = ? AND status != 'destroyed'`
  ).get(req.user.id).c;
  if (activeCount >= req.user.max_containers) {
    return res.status(429).json({ error: `Quota exceeded: max ${req.user.max_containers} containers` });
  }

  const id = uuid();
  const containerName = name || `${template.key}-${id.slice(0, 8)}`;
  const hostId = hostPool.pickHost(); // multi-host scheduling: least-loaded enabled host

  db.prepare(`INSERT INTO containers
    (id, user_id, name, template_key, image, status, cpu_limit, memory_limit_mb, exposed_port, host_id)
    VALUES (?, ?, ?, ?, ?, 'creating', ?, ?, ?, ?)`)
    .run(id, req.user.id, containerName, template.key, template.image,
         req.user.cpu_limit, req.user.memory_limit_mb, template.exposed_port, hostId);

  res.status(202).json({ id, status: 'creating', hostId });

  // Provision asynchronously so the API responds immediately; client polls or uses WS.
  try {
    const { dockerId, volumeName, hostPort } = await dockerService.createSandbox({
      id,
      image: template.image,
      cpuLimit: req.user.cpu_limit,
      memoryLimitMb: req.user.memory_limit_mb,
      exposedPort: template.exposed_port,
      cmd: template.default_cmd ? template.default_cmd.split(' ') : undefined,
      hostId,
    });

    let subdomain = null;
    if (hostPort) {
      subdomain = `${containerName}-${id.slice(0, 6)}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      proxyManager.registerRoute(subdomain, hostPort);
    }

    db.prepare(`UPDATE containers SET docker_id = ?, volume_name = ?, host_port = ?, proxy_subdomain = ?,
                status = 'running', last_active_at = datetime('now') WHERE id = ?`)
      .run(dockerId, volumeName, hostPort, subdomain, id);

    logAction({ userId: req.user.id, action: 'container.create', target: id, detail: { template: template.key } });
  } catch (err) {
    console.error('[containers] provisioning failed:', err.message);
    db.prepare(`UPDATE containers SET status = 'error' WHERE id = ?`).run(id);
    logAction({ userId: req.user.id, action: 'container.create_failed', target: id, detail: { error: err.message } });
  }
});

router.post('/:id/start', requireAuth, requireContainerOwnership, async (req, res) => {
  try {
    await dockerService.startSandbox(req.container.docker_id, req.container.host_id);
    db.prepare(`UPDATE containers SET status = 'running', last_active_at = datetime('now') WHERE id = ?`).run(req.container.id);
    logAction({ userId: req.user.id, action: 'container.start', target: req.container.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/stop', requireAuth, requireContainerOwnership, async (req, res) => {
  try {
    await dockerService.stopSandbox(req.container.docker_id, req.container.host_id);
    db.prepare(`UPDATE containers SET status = 'stopped' WHERE id = ?`).run(req.container.id);
    logAction({ userId: req.user.id, action: 'container.stop', target: req.container.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/restart', requireAuth, requireContainerOwnership, async (req, res) => {
  try {
    await dockerService.restartSandbox(req.container.docker_id, req.container.host_id);
    db.prepare(`UPDATE containers SET status = 'running', last_active_at = datetime('now') WHERE id = ?`).run(req.container.id);
    logAction({ userId: req.user.id, action: 'container.restart', target: req.container.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Snapshot: commit current container filesystem state to a reusable image ---
router.post('/:id/snapshot', requireAuth, requireContainerOwnership, async (req, res) => {
  try {
    const repoTag = `snapshot/${req.container.name}:${Date.now()}`;
    await dockerService.snapshotSandbox(req.container.docker_id, repoTag, req.container.host_id);
    logAction({ userId: req.user.id, action: 'container.snapshot', target: req.container.id, detail: { repoTag } });
    res.json({ ok: true, image: repoTag });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAuth, requireContainerOwnership, async (req, res) => {
  try {
    if (req.container.docker_id) {
      await dockerService.removeSandbox(req.container.docker_id, {
        removeVolume: req.query.keepData !== 'true',
        volumeName: req.container.volume_name,
        hostId: req.container.host_id,
      });
    }
    if (req.container.proxy_subdomain) proxyManager.removeRoute(req.container.proxy_subdomain);
    db.prepare(`UPDATE containers SET status = 'destroyed' WHERE id = ?`).run(req.container.id);
    logAction({ userId: req.user.id, action: 'container.delete', target: req.container.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- One-shot stats snapshot (real-time streaming version is over WebSocket) ---
router.get('/:id/stats', requireAuth, requireContainerOwnership, async (req, res) => {
  if (!req.container.docker_id || req.container.status !== 'running') {
    return res.status(409).json({ error: 'Container is not running' });
  }
  try {
    const stats = await dockerService.getStatsOnce(req.container.docker_id, req.container.host_id);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Metrics history (backs the "history" toggle on the live chart / Grafana-style trend view) ---
router.get('/:id/metrics-history', requireAuth, requireContainerOwnership, (req, res) => {
  const rows = db.prepare(
    `SELECT cpu_percent, mem_percent, mem_usage_mb, net_rx_bytes, net_tx_bytes, recorded_at
     FROM metrics_history WHERE container_id = ? ORDER BY recorded_at DESC LIMIT 500`
  ).all(req.container.id);
  res.json(rows.reverse());
});

router.get('/:id/audit', requireAuth, requireContainerOwnership, (req, res) => {
  const rows = db.prepare('SELECT * FROM audit_log WHERE target = ? ORDER BY created_at DESC LIMIT 100')
    .all(req.container.id);
  res.json(rows);
});

function serialize(c) {
  return {
    id: c.id,
    name: c.name,
    templateKey: c.template_key,
    image: c.image,
    status: c.status,
    cpuLimit: c.cpu_limit,
    memoryLimitMb: c.memory_limit_mb,
    hostPort: c.host_port,
    url: c.proxy_subdomain ? `http://${c.proxy_subdomain}.${config.proxy.baseDomain}` : null,
    createdAt: c.created_at,
    lastActiveAt: c.last_active_at,
  };
}

module.exports = router;
