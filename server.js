#!/usr/bin/env node
// Agent Arena — Local server
// Serves the demo + packages agent downloads as zip

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const WebSocket = require('ws');

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

  // API: hire/deploy agent — runs installer + spawns sub-agent
  const hireMatch = url.pathname.match(/^\/api\/agents\/([a-z0-9-]+)\/hire$/);
  if (hireMatch && req.method === 'POST') {
    const name = hireMatch[1];
    const pkgDir = path.join(PACKAGES, name);
    if (!fs.existsSync(path.join(pkgDir, 'agent.json'))) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Agent not found' }));
      return;
    }

    try {
      // Read the agent's SOUL.md and BOOTSTRAP.md
      const soul = fs.readFileSync(path.join(pkgDir, 'SOUL.md'), 'utf8');
      const bootstrap = fs.existsSync(path.join(pkgDir, 'BOOTSTRAP.md'))
        ? fs.readFileSync(path.join(pkgDir, 'BOOTSTRAP.md'), 'utf8')
        : '';
      const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'agent.json'), 'utf8'));

      // Build the prompt for the sub-agent
      const prompt = `${soul}\n\n---\n\nFIRST BOOT INSTRUCTIONS:\n${bootstrap}\n\nThis is your first time waking up. Follow the bootstrap instructions. Introduce yourself, show what you can do, and ask what to work on.`;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        agent: manifest,
        prompt: prompt,
        message: `${manifest.displayName} is ready to deploy. Use the prompt to spawn a sub-agent.`
      }));
    } catch (e) {
      console.error('Hire error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to prepare agent' }));
    }
    return;
  }

  // API: collect email on hire
  if (url.pathname === '/api/signup' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { email, agent, timestamp } = JSON.parse(body);
        if (!email || !email.includes('@')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid email' }));
          return;
        }
        // Append to signups file
        const signupsFile = path.join(BASE, 'signups.jsonl');
        const entry = JSON.stringify({ email, agent, timestamp: timestamp || new Date().toISOString(), ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress }) + '\n';
        fs.appendFileSync(signupsFile, entry);
        console.log(`  📧 New signup: ${email} → ${agent}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
    return;
  }

  // API: list signups (admin)
  if (url.pathname === '/api/signups' && req.method === 'GET') {
    const signupsFile = path.join(BASE, 'signups.jsonl');
    if (fs.existsSync(signupsFile)) {
      const lines = fs.readFileSync(signupsFile, 'utf8').trim().split('\n').filter(Boolean);
      const signups = lines.map(l => JSON.parse(l));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: signups.length, signups }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: 0, signups: [] }));
    }
    return;
  }

  // (Chat handled via WebSocket below)

  // Static files — serve from project dir first, then demo
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  let fullPath = path.join(BASE, filePath);

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

// === WebSocket server for real-time agent chat ===
const wss = new WebSocket.Server({ server });

// Read gateway token
let GATEWAY_TOKEN = null;
try {
  const config = JSON.parse(fs.readFileSync(path.join(require('os').homedir(), '.openclaw/openclaw.json'), 'utf8'));
  GATEWAY_TOKEN = config.gateway?.auth?.token;
  if (GATEWAY_TOKEN) console.log('  ✅ Gateway token loaded');
} catch (e) {
  console.log('  ⚠️  Could not read gateway token — chat proxy disabled');
}

// Active agent sessions: { clientId: { gw: WebSocket, sessionKey: string } }
const sessions = {};
let clientIdCounter = 0;

wss.on('connection', (clientWs) => {
  const clientId = ++clientIdCounter;
  console.log(`  [ws] Client ${clientId} connected`);

  clientWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // Hire: spawn agent
      if (msg.type === 'hire') {
        const pkgDir = path.join(PACKAGES, msg.agentPkg);
        if (!fs.existsSync(path.join(pkgDir, 'agent.json'))) {
          clientWs.send(JSON.stringify({ type: 'error', error: 'Agent not found' }));
          return;
        }

        const soul = fs.readFileSync(path.join(pkgDir, 'SOUL.md'), 'utf8');
        const bootstrap = fs.existsSync(path.join(pkgDir, 'BOOTSTRAP.md'))
          ? fs.readFileSync(path.join(pkgDir, 'BOOTSTRAP.md'), 'utf8')
          : '';
        const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'agent.json'), 'utf8'));

        // Connect to OpenClaw gateway
        const gw = new WebSocket(`ws://127.0.0.1:18789/`);

        gw.on('open', () => {
          console.log(`  [ws] Client ${clientId}: connected to gateway for ${msg.agentPkg}`);

          // Send the agent's personality as first message
          const bootMessage = `You are now acting as a different agent. Completely adopt this new persona:\n\n${soul}\n\n---\n\n${bootstrap}\n\nIMPORTANT: You are NOT Hopper. You are the ${manifest.displayName}. Stay completely in character as described in the SOUL.md above. This is your first boot — follow the bootstrap instructions. Introduce yourself and ask what to work on.`;

          gw.send(JSON.stringify({
            id: 1,
            method: 'chat.send',
            params: {
              message: bootMessage,
              ...(GATEWAY_TOKEN ? {} : {})
            }
          }));

          sessions[clientId] = { gw, manifest };
        });

        gw.on('message', (data) => {
          try {
            const gwMsg = JSON.parse(data.toString());

            // Forward chat events to client
            if (gwMsg.type === 'chat' || gwMsg.method === 'chat' || gwMsg.event === 'chat') {
              clientWs.send(JSON.stringify({
                type: 'agent-message',
                data: gwMsg
              }));
            }

            // Forward RPC responses
            if (gwMsg.id && gwMsg.result) {
              clientWs.send(JSON.stringify({
                type: 'rpc-response',
                data: gwMsg
              }));
            }
          } catch (e) {}
        });

        gw.on('error', (e) => {
          console.error(`  [ws] Gateway error for client ${clientId}:`, e.message);
          clientWs.send(JSON.stringify({ type: 'error', error: 'Gateway connection failed: ' + e.message }));
        });

        gw.on('close', () => {
          console.log(`  [ws] Gateway closed for client ${clientId}`);
        });

        clientWs.send(JSON.stringify({ type: 'hire-ok', agent: manifest.displayName }));
      }

      // Chat: send message to agent
      if (msg.type === 'chat') {
        const session = sessions[clientId];
        if (!session || !session.gw || session.gw.readyState !== WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: 'error', error: 'No active agent session. Hire an agent first.' }));
          return;
        }

        session.gw.send(JSON.stringify({
          id: Date.now(),
          method: 'chat.send',
          params: { message: msg.message }
        }));
      }

    } catch (e) {
      console.error(`  [ws] Parse error:`, e.message);
    }
  });

  clientWs.on('close', () => {
    console.log(`  [ws] Client ${clientId} disconnected`);
    if (sessions[clientId]?.gw) {
      sessions[clientId].gw.close();
      delete sessions[clientId];
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n  🦞 Agent Arena server running on http://localhost:${PORT}\n`);
  console.log(`  Endpoints:`);
  console.log(`    GET /                        → Arena UI`);
  console.log(`    GET /api/agents              → List all agents`);
  console.log(`    GET /api/agents/:name        → Agent details`);
  console.log(`    GET /api/agents/:name/download → Download agent package`);
  console.log(`    GET /api/install.sh           → Install script\n`);
});
