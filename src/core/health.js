const http = require('http');
const log = require('../utils/logger').child({ module: 'health' });

let state = {
  ok: true,
  startedAt: new Date().toISOString(),
  lastTriageSweep: null,
  lastMessageHandled: null,
  integrations: {},
};

/**
 * Start the health check HTTP server.
 */
function start(port) {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      const status = getStatus();
      res.writeHead(status.ok ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, () => {
    log.info({ port }, 'Health check server started');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log.warn({ port }, 'Health port in use, skipping');
    } else {
      log.error({ err }, 'Health server error');
    }
  });

  return server;
}

function getStatus() {
  return {
    ok: state.ok,
    uptime: Math.floor(process.uptime()),
    startedAt: state.startedAt,
    lastTriageSweep: state.lastTriageSweep,
    lastMessageHandled: state.lastMessageHandled,
    integrations: state.integrations,
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    },
  };
}

function recordTriageSweep() { state.lastTriageSweep = new Date().toISOString(); }
function recordMessage() { state.lastMessageHandled = new Date().toISOString(); }
function setIntegrations(results) {
  state.integrations = {};
  for (const r of results) {
    state.integrations[r.name] = r.ok ? 'ok' : `failed: ${r.error}`;
  }
}
function setOk(ok) { state.ok = ok; }

module.exports = { start, getStatus, recordTriageSweep, recordMessage, setIntegrations, setOk };
