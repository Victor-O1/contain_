const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { requireAuth } = require('../middleware/authMiddleware');
const dockerService = require('../docker/dockerService');
const hostPool = require('../docker/hostPool');
const { listLanguages, getLanguage } = require('../compiler/languages');
const { logAction } = require('../utils/audit');

const router = express.Router();

const runLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: config.compiler.runsPerHour,
  standardHeaders: true,
  message: { error: `Rate limit: max ${config.compiler.runsPerHour} runs/hour` },
  keyGenerator: (req) => req.user?.id || req.ip,
});

// GET /api/compiler/languages — populates the language dropdown + starter snippets
router.get('/languages', requireAuth, (req, res) => {
  res.json(listLanguages());
});

// POST /api/compiler/run — compile/run a snippet in an isolated, network-disabled container
router.post('/run', requireAuth, runLimiter, async (req, res) => {
  const { language, code, stdin } = req.body;

  const lang = getLanguage(language);
  if (!lang) return res.status(400).json({ error: `Unsupported language: ${language}` });
  if (typeof code !== 'string' || code.trim().length === 0) {
    return res.status(400).json({ error: 'code is required' });
  }
  if (code.length > config.compiler.maxCodeLength) {
    return res.status(400).json({ error: `Code exceeds ${config.compiler.maxCodeLength} character limit` });
  }

  try {
    const hostId = hostPool.pickHost();
    const startedAt = Date.now();

    const result = await dockerService.runCodeSnippet({
      image: lang.image,
      filename: lang.filename,
      code,
      cmd: lang.cmd,
      stdin: typeof stdin === 'string' ? stdin : undefined,
      cpuLimit: config.compiler.cpuLimit,
      memoryLimitMb: config.compiler.memoryLimitMb,
      timeoutMs: config.compiler.timeoutMs,
      hostId,
    });

    const durationMs = Date.now() - startedAt;
    logAction({
      userId: req.user.id,
      action: 'compiler.run',
      detail: { language, exitCode: result.exitCode, timedOut: result.timedOut, durationMs },
      ip: req.ip,
    });

    res.json({ ...result, durationMs });
  } catch (err) {
    console.error('[compiler] run failed:', err.message);
    res.status(500).json({ error: 'Execution failed', detail: err.message });
  }
});

module.exports = router;
