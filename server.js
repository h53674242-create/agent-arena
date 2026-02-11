#!/usr/bin/env node
// Agent Arena — Local server
// Serves the demo + packages agent downloads as zip
// Chat proxy uses OpenAI-compatible HTTP API (gateway port 18789)

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = 3333;
const BASE = __dirname;
const PACKAGES = path.join(BASE, 'packages');
const GATEWAY_PORT = 18789;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.md': 'text/markdown', '.sh': 'application/x-sh',
};

// Read gateway token
let GATEWAY_TOKEN = null;
try {
  const config = JSON.parse(fs.readFileSync(path.join(require('os').homedir(), '.openclaw/openclaw.json'), 'utf8'));
  GATEWAY_TOKEN = config.gateway?.auth?.token;
  if (GATEWAY_TOKEN) console.log('  ✅ Gateway token loaded');
} catch (e) {
  console.log('  ⚠️  Could not read gateway token — chat proxy disabled');
}

// In-memory chat sessions: { sessionId: { agentPkg, messages: [{role, content}] } }
const chatSessions = {};

function makeGatewayRequest(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: GATEWAY_PORT,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...(GATEWAY_TOKEN ? { 'Authorization': `Bearer ${GATEWAY_TOKEN}` } : {}),
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Invalid JSON from gateway')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Gateway timeout')); });
    req.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

  // API: chat with agent (HTTP proxy to gateway)
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    if (!GATEWAY_TOKEN) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Gateway token not configured' }));
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { sessionId, agentPkg, message } = JSON.parse(body);
        if (!message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'message required' }));
          return;
        }

        // Get or create session
        const sid = sessionId || `arena-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        if (!chatSessions[sid]) {
          // Build system prompt from agent package
          const pkgDir = path.join(PACKAGES, agentPkg || 'founder-agent');
          let systemPrompt = 'You are a helpful AI agent.';
          if (fs.existsSync(path.join(pkgDir, 'agent.json'))) {
            const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'agent.json'), 'utf8'));
            const soul = fs.existsSync(path.join(pkgDir, 'SOUL.md'))
              ? fs.readFileSync(path.join(pkgDir, 'SOUL.md'), 'utf8') : '';
            const bootstrap = fs.existsSync(path.join(pkgDir, 'BOOTSTRAP.md'))
              ? fs.readFileSync(path.join(pkgDir, 'BOOTSTRAP.md'), 'utf8') : '';
            systemPrompt = `You are ${manifest.displayName}. Completely adopt this persona:\n\n${soul}\n\n---\n\nFIRST BOOT:\n${bootstrap}\n\nStay in character. Be concise but personality-rich. This is a demo chat on the Agent Arena website.`;
          }
          chatSessions[sid] = { agentPkg: agentPkg || 'founder-agent', messages: [{ role: 'system', content: systemPrompt }] };
        }

        const session = chatSessions[sid];
        session.messages.push({ role: 'user', content: message });

        // Keep context window manageable (system + last 20 messages)
        const trimmed = [session.messages[0], ...session.messages.slice(-20)];

        console.log(`  💬 [${sid}] User: ${message.slice(0, 80)}...`);

        const result = await makeGatewayRequest({
          model: 'openclaw',
          messages: trimmed,
          user: sid,
        });

        const reply = result.choices?.[0]?.message?.content || 'Sorry, I had trouble responding.';
        session.messages.push({ role: 'assistant', content: reply });

        console.log(`  🤖 [${sid}] Agent: ${reply.slice(0, 80)}...`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, sessionId: sid, reply }));
      } catch (e) {
        console.error('Chat error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Chat failed: ' + e.message }));
      }
    });
    return;
  }

  // API: hire/deploy agent
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
      const soul = fs.readFileSync(path.join(pkgDir, 'SOUL.md'), 'utf8');
      const bootstrap = fs.existsSync(path.join(pkgDir, 'BOOTSTRAP.md'))
        ? fs.readFileSync(path.join(pkgDir, 'BOOTSTRAP.md'), 'utf8') : '';
      const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'agent.json'), 'utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true, agent: manifest,
        prompt: `${soul}\n\n---\n\nFIRST BOOT INSTRUCTIONS:\n${bootstrap}`,
        message: `${manifest.displayName} is ready to deploy.`
      }));
    } catch (e) {
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

  // Static files
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  let fullPath = path.join(BASE, filePath);

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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🦞 Agent Arena server running on http://localhost:${PORT}\n`);
  console.log(`  Endpoints:`);
  console.log(`    GET  /                        → Arena UI`);
  console.log(`    GET  /api/agents              → List all agents`);
  console.log(`    GET  /api/agents/:name        → Agent details`);
  console.log(`    GET  /api/agents/:name/download → Download agent package`);
  console.log(`    GET  /api/install.sh           → Install script`);
  console.log(`    POST /api/chat                → Chat with agent (gateway proxy)\n`);
});
