const http = require('http');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./src/config');

require('./src/db/db'); // initializes schema + seeds templates on first run

const containerRoutes = require('./src/routes/containers');
const templateRoutes = require('./src/routes/templates');
const adminRoutes = require('./src/routes/admin');
const fileRoutes = require('./src/routes/files');
const ciRoutes = require('./src/routes/ci');
const compilerRoutes = require('./src/routes/compiler');
const prometheusMetrics = require('./src/routes/prometheusMetrics');
const { attachWebSocketServer } = require('./src/ws/wsRouter');
const { startIdleReaper } = require('./src/utils/idleReaper');

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/api/containers', containerRoutes);
app.use('/api/containers', fileRoutes); // /api/containers/:id/files...
app.use('/api/templates', templateRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/ci', ciRoutes);
app.use('/api/compiler', compilerRoutes);
app.use('/metrics', prometheusMetrics);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = http.createServer(app);
attachWebSocketServer(server);
startIdleReaper();

server.listen(config.port, () => {
  console.log(`Container platform API listening on :${config.port}`);
  console.log(`WebSocket endpoints: ws://localhost:${config.port}/ws/exec/:id  and  /ws/stats/:id`);
});
