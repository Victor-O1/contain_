const express = require('express');
const client = require('prom-client');
const db = require('../db/db');

const router = express.Router();
const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry }); // process/event-loop metrics for the control plane itself

const activeContainersGauge = new client.Gauge({
  name: 'platform_active_containers',
  help: 'Number of currently running sandbox containers',
  registers: [registry],
});
const totalUsersGauge = new client.Gauge({
  name: 'platform_total_users',
  help: 'Total registered users',
  registers: [registry],
});
const containerCpuGauge = new client.Gauge({
  name: 'platform_container_cpu_percent',
  help: 'Most recent CPU% sample per container',
  labelNames: ['container_id', 'container_name'],
  registers: [registry],
});
const containerMemGauge = new client.Gauge({
  name: 'platform_container_memory_percent',
  help: 'Most recent memory% sample per container',
  labelNames: ['container_id', 'container_name'],
  registers: [registry],
});

// GET /metrics — standard Prometheus scrape target (add this URL as a Prometheus job).
router.get('/', async (req, res) => {
  activeContainersGauge.set(db.prepare(`SELECT COUNT(*) c FROM containers WHERE status = 'running'`).get().c);
  totalUsersGauge.set(db.prepare('SELECT COUNT(*) c FROM users').get().c);

  const latestPerContainer = db.prepare(`
    SELECT m.container_id, c.name, m.cpu_percent, m.mem_percent
    FROM metrics_history m
    JOIN containers c ON c.id = m.container_id
    WHERE m.id IN (SELECT MAX(id) FROM metrics_history GROUP BY container_id)
  `).all();

  containerCpuGauge.reset();
  containerMemGauge.reset();
  for (const row of latestPerContainer) {
    containerCpuGauge.set({ container_id: row.container_id, container_name: row.name }, row.cpu_percent || 0);
    containerMemGauge.set({ container_id: row.container_id, container_name: row.name }, row.mem_percent || 0);
  }

  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});

module.exports = router;
