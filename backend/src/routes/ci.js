const express = require('express');
const config = require('../config');
const dockerService = require('../docker/dockerService');
const hostPool = require('../docker/hostPool');
const { logAction } = require('../utils/audit');

const router = express.Router();

/**
 * CI/CD integration: lets an external pipeline (e.g. a GitHub Actions step) spin up a
 * throwaway container, run a command to completion, and get back exit code + logs —
 * without needing a full user account. Protected by a static API key rather than JWT,
 * since pipeline runners aren't platform users.
 *
 * Example GitHub Actions step:
 *   - name: Run tests in sandbox
 *     run: |
 *       curl -s -X POST https://platform.example.com/api/ci/run \
 *         -H "X-API-Key: ${{ secrets.PLATFORM_CI_KEY }}" \
 *         -H "Content-Type: application/json" \
 *         -d '{"image":"node:20","cmd":["npm","test"]}'
 */
function requireCiKey(req, res, next) {
  if (!config.ci.apiKey) return res.status(503).json({ error: 'CI integration not configured (CI_API_KEY unset)' });
  if (req.headers['x-api-key'] !== config.ci.apiKey) return res.status(401).json({ error: 'Invalid CI API key' });
  next();
}

router.post('/run', requireCiKey, async (req, res) => {
  const { image, cmd, cpuLimit, memoryLimitMb, timeoutMs } = req.body;
  if (!image || !Array.isArray(cmd) || cmd.length === 0) {
    return res.status(400).json({ error: 'image and cmd[] are required' });
  }
  try {
    const hostId = hostPool.pickHost();
    const result = await dockerService.runEphemeralJob({
      image, cmd,
      cpuLimit: cpuLimit || 1,
      memoryLimitMb: memoryLimitMb || 512,
      timeoutMs: timeoutMs || 120000,
      hostId,
    });
    logAction({ action: 'ci.job_run', detail: { image, cmd, exitCode: result.exitCode }, ip: req.ip });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
