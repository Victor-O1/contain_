const fs = require('fs');
const path = require('path');
const config = require('../config');

// Directory nginx (running alongside, mounting this same folder) watches for vhost includes.
const PROXY_CONF_DIR = path.join(__dirname, '..', '..', 'data', 'proxy-conf.d');

function ensureDir() {
  if (!fs.existsSync(PROXY_CONF_DIR)) fs.mkdirSync(PROXY_CONF_DIR, { recursive: true });
}

/**
 * Writes an nginx server block that routes <subdomain>.<baseDomain> -> 127.0.0.1:<hostPort>.
 * A sibling `nginx -s reload` (or `docker exec nginx nginx -s reload`) picks this up.
 * This gives every sandbox a stable, isolated public URL without exposing raw docker ports.
 */
function registerRoute(subdomain, hostPort) {
  if (!config.proxy.enabled) return null;
  ensureDir();
  const fqdn = `${subdomain}.${config.proxy.baseDomain}`;
  const confPath = path.join(PROXY_CONF_DIR, `${subdomain}.conf`);
  const block = `
server {
    listen 80;
    server_name ${fqdn};

    location / {
        proxy_pass http://127.0.0.1:${hostPort};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_http_version 1.1;
    }
}
`.trim();
  fs.writeFileSync(confPath, block);
  return fqdn;
}

function removeRoute(subdomain) {
  const confPath = path.join(PROXY_CONF_DIR, `${subdomain}.conf`);
  if (fs.existsSync(confPath)) fs.unlinkSync(confPath);
}

module.exports = { registerRoute, removeRoute, PROXY_CONF_DIR };
