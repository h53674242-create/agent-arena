#!/usr/bin/env node
// Agent Arena — Local server
// Serves the demo + packages agent downloads as zip

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = 3333;
const BASE = __dirname;
const PACKAGES = path.join(BASE, 'packages');
const DEMO = path.join(BASE, '..', 'skilldoc', 'demo');

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.md': 'text/markdown', '.sh': 'application/x-sh',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // API: list agents
  if (url.pathname === '/api/agents') {
    const agents = [];
    for (const dir of fs.readdirSync(PACKAGES)) {
      const manifest = path.join(PACKAGES, dir, 'agent.json');
      if (fs.existsSync(manifest)) {
        agents.push(JSON.parse(fs.readFileSync(manifest, 'utf8')));
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(agents));
    return;
  }

  // API: get agent details
  const agentMatch = url.pathname.match(/^\/api\/agents\/([a-z0-9-]+)$/);
  if (agentMatch) {
    const name = agentMatch[1];
    const manifest = path.join(PACKAGES, name, 'agent.json');
    if (fs.existsSync(manifest)) {
      const agent = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      // Include file listing
      const dir = path.join(PACKAGES, name);
      agent.files = fs.readdirSync(dir).filter(f => !f.startsWith('.'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(agent));
    } else {
      res.writeHead(404); res.end('Agent not found');
    }
    return;
  }

  // API: download agent as tar.gz
  const dlMatch = url.pathname.match(/^\/api\/agents\/([a-z0-9-]+)\/download$/);
  if (dlMatch) {
    const name = dlMatch[1];
    const pkgDir = path.join(PACKAGES, name);
    if (!fs.existsSync(path.join(pkgDir, 'agent.json'))) {
      res.writeHead(404); res.end('Agent not found'); return;
    }
    try {
      // Pre-build tar to a temp file to avoid stream issues
      const tmpFile = path.join(require('os').tmpdir(), `${name}-${Date.now()}.tar.gz`);
      execSync(`tar -czf "${tmpFile}" -C "${PACKAGES}" "${name}"`);
      const tarData = fs.readFileSync(tmpFile);
      fs.unlinkSync(tmpFile);
      res.writeHead(200, {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${name}.tar.gz"`,
        'Content-Length': tarData.length,
      });
      res.end(tarData);
    } catch (e) {
      console.error('Download error:', e.message);
      res.writeHead(500); res.end('Failed to create package');
    }
    return;
  }

  // API: get install script
  if (url.pathname === '/api/install.sh') {
    const script = path.join(BASE, 'installer', 'install.sh');
    if (fs.existsSync(script)) {
      res.writeHead(200, { 'Content-Type': 'application/x-sh' });
      res.end(fs.readFileSync(script));
    } else {
      res.writeHead(404); res.end('Install script not found');
    }
    return;
  }

  // Static files — serve from demo dir
  let filePath = url.pathname === '/' ? '/agents.html' : url.pathname;
  let fullPath = path.join(DEMO, filePath);

  if (!fs.existsSync(fullPath)) {
    fullPath = path.join(BASE, filePath);
  }

  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(fs.readFileSync(fullPath));
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

process.on('uncaughtException', (e) => { console.error('Uncaught:', e.message); });
process.on('unhandledRejection', (e) => { console.error('Unhandled:', e); });

server.listen(PORT, () => {
  console.log(`\n  🦞 Agent Arena server running on http://localhost:${PORT}\n`);
  console.log(`  Endpoints:`);
  console.log(`    GET /                        → Arena UI`);
  console.log(`    GET /api/agents              → List all agents`);
  console.log(`    GET /api/agents/:name        → Agent details`);
  console.log(`    GET /api/agents/:name/download → Download agent package`);
  console.log(`    GET /api/install.sh           → Install script\n`);
});
