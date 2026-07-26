const Docker = require('dockerode');
const db = require('../db/db');

/**
 * Multi-host orchestration (lightweight alternative to Swarm/k3s):
 * The platform can talk to more than one Docker Engine — each row in the `hosts`
 * table is either a local socket or a remote `tcp://host:2376` daemon (with TLS
 * configured on the daemon side). New sandboxes are scheduled onto whichever
 * enabled host currently has the fewest active containers.
 *
 * To go further (real bin-packing, failover, rolling updates) swap this module's
 * scheduling for a Swarm/k3s API call — the rest of the platform (routes, WS
 * handlers) only depends on getClientForHost()/pickHost(), so that's the one
 * seam that needs to change.
 */

const clients = new Map(); // hostId -> Docker client instance

function buildClient(connection) {
  if (connection.startsWith('tcp://') || connection.startsWith('http')) {
    const u = new URL(connection);
    return new Docker({ host: u.hostname, port: u.port || 2376 });
  }
  return new Docker({ socketPath: connection });
}

function getClientForHost(hostId) {
  if (clients.has(hostId)) return clients.get(hostId);
  const host = db.prepare('SELECT * FROM hosts WHERE id = ?').get(hostId);
  if (!host) throw new Error(`Unknown Docker host: ${hostId}`);
  const client = buildClient(host.connection);
  clients.set(hostId, client);
  return client;
}

/** Picks the enabled host with the fewest currently-running sandboxes. */
function pickHost() {
  const hosts = db.prepare('SELECT * FROM hosts WHERE enabled = 1').all();
  if (hosts.length === 0) throw new Error('No enabled Docker hosts configured');
  if (hosts.length === 1) return hosts[0].id;

  const counts = db.prepare(
    `SELECT host_id, COUNT(*) AS c FROM containers WHERE status = 'running' GROUP BY host_id`
  ).all();
  const countMap = Object.fromEntries(counts.map((r) => [r.host_id, r.c]));

  let best = hosts[0];
  let bestCount = countMap[best.id] || 0;
  for (const h of hosts.slice(1)) {
    const c = countMap[h.id] || 0;
    if (c < bestCount) { best = h; bestCount = c; }
  }
  return best.id;
}

function listHosts() {
  return db.prepare('SELECT * FROM hosts ORDER BY created_at').all();
}

function addHost({ id, label, connection }) {
  db.prepare(`INSERT INTO hosts (id, label, connection, enabled) VALUES (?, ?, ?, 1)`)
    .run(id, label, connection);
}

function setHostEnabled(id, enabled) {
  db.prepare(`UPDATE hosts SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id);
}

module.exports = { getClientForHost, pickHost, listHosts, addHost, setHostEnabled };
