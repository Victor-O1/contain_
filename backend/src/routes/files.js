const express = require('express');
const multer = require('multer');
const tar = require('tar-stream');
const db = require('../db/db');
const { requireAuth, requireContainerOwnership } = require('../middleware/authMiddleware');
const dockerService = require('../docker/dockerService');
const { logAction } = require('../utils/audit');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function assertRunning(req, res) {
  if (req.container.status !== 'running' || !req.container.docker_id) {
    res.status(409).json({ error: 'Container is not running' });
    return false;
  }
  return true;
}

// Directories users are allowed to browse — keeps the file manager scoped to the workspace volume.
const ROOT = '/workspace';
function safePath(p) {
  const cleaned = ('/' + (p || '')).replace(/\.\./g, '').replace(/\/+/g, '/');
  return `${ROOT}${cleaned}`.replace(/\/+$/, '') || ROOT;
}

// --- List directory contents (uses `ls` inside the container; no extra daemon deps needed) ---
router.get('/:id/files', requireAuth, requireContainerOwnership, async (req, res) => {
  if (!assertRunning(req, res)) return;
  const dir = safePath(req.query.path);
  try {
    const { output, exitCode } = await dockerService.runCommand(
      req.container.docker_id,
      ['sh', '-c', `mkdir -p '${dir}' && ls -lA --time-style=+%s '${dir}'`],
      req.container.host_id
    );
    if (exitCode !== 0) return res.status(400).json({ error: 'Could not list directory', detail: output });

    const entries = output
      .split('\n')
      .slice(1) // drop "total N" line
      .filter(Boolean)
      .map(parseLsLine)
      .filter(Boolean);

    res.json({ path: dir.replace(ROOT, '') || '/', entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function parseLsLine(line) {
  const parts = line.split(/\s+/);
  if (parts.length < 7) return null;
  const perms = parts[0];
  const size = parseInt(parts[4], 10);
  const mtime = parseInt(parts[5], 10);
  const name = parts.slice(6).join(' ');
  if (name === '.' || name === '..') return null;
  return {
    name,
    isDir: perms.startsWith('d'),
    size: Number.isNaN(size) ? 0 : size,
    modifiedAt: Number.isNaN(mtime) ? null : mtime * 1000,
  };
}

// --- Create directory ---
router.post('/:id/files/mkdir', requireAuth, requireContainerOwnership, async (req, res) => {
  if (!assertRunning(req, res)) return;
  const target = safePath(`${req.body.path || ''}/${req.body.name}`);
  try {
    const { exitCode, output } = await dockerService.runCommand(
      req.container.docker_id, ['mkdir', '-p', target], req.container.host_id
    );
    if (exitCode !== 0) return res.status(400).json({ error: output });
    logAction({ userId: req.user.id, action: 'file.mkdir', target: req.container.id, detail: { path: target } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Delete file or directory ---
router.delete('/:id/files', requireAuth, requireContainerOwnership, async (req, res) => {
  if (!assertRunning(req, res)) return;
  const target = safePath(req.query.path);
  if (target === ROOT) return res.status(400).json({ error: 'Cannot delete the workspace root' });
  try {
    const { exitCode, output } = await dockerService.runCommand(
      req.container.docker_id, ['rm', '-rf', target], req.container.host_id
    );
    if (exitCode !== 0) return res.status(400).json({ error: output });
    logAction({ userId: req.user.id, action: 'file.delete', target: req.container.id, detail: { path: target } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Download a file (streams a tar from Docker, unwraps it to raw bytes) ---
router.get('/:id/files/download', requireAuth, requireContainerOwnership, async (req, res) => {
  if (!assertRunning(req, res)) return;
  const target = safePath(req.query.path);
  try {
    const archiveStream = await dockerService.getArchive(req.container.docker_id, target, req.container.host_id);
    const extract = tar.extract();
    let sent = false;

    extract.on('entry', (header, stream, next) => {
      if (!sent && header.type === 'file') {
        sent = true;
        res.setHeader('Content-Disposition', `attachment; filename="${header.name.split('/').pop()}"`);
        res.setHeader('Content-Length', header.size);
        stream.pipe(res);
        stream.on('end', next);
      } else {
        stream.on('end', next);
        stream.resume();
      }
    });
    extract.on('finish', () => { if (!sent) res.status(404).json({ error: 'Not a downloadable file' }); });
    archiveStream.pipe(extract);

    logAction({ userId: req.user.id, action: 'file.download', target: req.container.id, detail: { path: target } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Upload a file into a directory (packs it into a tar, streams via putArchive) ---
router.post('/:id/files/upload', requireAuth, requireContainerOwnership, upload.single('file'), async (req, res) => {
  if (!assertRunning(req, res)) return;
  if (!req.file) return res.status(400).json({ error: 'No file provided (field name: file)' });
  const targetDir = safePath(req.body.path);

  try {
    const pack = tar.pack();
    pack.entry({ name: req.file.originalname, size: req.file.size }, req.file.buffer);
    pack.finalize();

    await dockerService.putArchive(req.container.docker_id, pack, targetDir, req.container.host_id);
    logAction({
      userId: req.user.id, action: 'file.upload', target: req.container.id,
      detail: { path: targetDir, filename: req.file.originalname, size: req.file.size },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
