const db = require('../db/db');
const config = require('../config');
const dockerService = require('../docker/dockerService');
const { logAction } = require('./audit');

/**
 * Periodically stops (not deletes) containers that have had no exec/stat activity
 * for longer than IDLE_TIMEOUT_MINUTES, to save host resources. Data is preserved
 * on the container's volume so it can be restarted later.
 */
function startIdleReaper() {
  const intervalMs = config.idle.checkIntervalMinutes * 60 * 1000;

  setInterval(async () => {
    const cutoff = `-${config.idle.timeoutMinutes} minutes`;
    const idleContainers = db.prepare(
      `SELECT * FROM containers WHERE status = 'running' AND last_active_at <= datetime('now', ?)`
    ).all(cutoff);

    for (const c of idleContainers) {
      try {
        await dockerService.stopSandbox(c.docker_id, c.host_id);
        db.prepare(`UPDATE containers SET status = 'stopped' WHERE id = ?`).run(c.id);
        logAction({ userId: c.user_id, action: 'container.auto_stop_idle', target: c.id });
        console.log(`[idle-reaper] stopped idle container ${c.name} (${c.id})`);
      } catch (err) {
        console.error(`[idle-reaper] failed to stop ${c.id}:`, err.message);
      }
    }
  }, intervalMs).unref();

  console.log(`[idle-reaper] running every ${config.idle.checkIntervalMinutes}m, timeout ${config.idle.timeoutMinutes}m`);
}

module.exports = { startIdleReaper };
