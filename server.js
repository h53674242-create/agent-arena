#!/usr/bin/env node
// Agent Arena — Local server with real Gateway WebSocket bridge
// Agents get FULL tool access through the gateway protocol

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = 3333;
const BASE = __dirname;
const PACKAGES = path.join(BASE, 'packages');
const GATEWAY_PORT = 18789;
const PROTOCOL_VERSION = 3;

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

// ============================================================
// Gateway WebSocket Connection (proper protocol handshake)
// ============================================================

class GatewayConnection {
  constructor(token) {
    this.token = token;
    this.ws = null;
    this.connected = false;
    this.pendingRequests = new Map(); // id -> { resolve, reject, timeout }
    this.eventHandlers = new Map(); // event name -> Set of callbacks
    this.reqIdCounter = 0;
    this.reconnectTimer = null;
    this.connect();
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    
    console.log('  🔌 Connecting to gateway...');
    this.ws = new WebSocket(`ws://127.0.0.1:${GATEWAY_PORT}/`);
    
    this.ws.on('open', () => {
      console.log('  🔌 WebSocket open, waiting for challenge...');
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this._handleMessage(msg);
      } catch (e) {
        console.error('  ❌ Parse error:', e.message);
      }
    });

    this.ws.on('close', (code, reason) => {
      console.log(`  🔌 Gateway disconnected: ${code} ${reason}`);
      this.connected = false;
      // Reject pending requests
      for (const [id, req] of this.pendingRequests) {
        clearTimeout(req.timeout);
        req.reject(new Error('Gateway disconnected'));
      }
      this.pendingRequests.clear();
      // Reconnect after delay
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    });

    this.ws.on('error', (e) => {
      console.error('  ❌ Gateway WS error:', e.message);
    });
  }

  _handleMessage(msg) {
    // Handle connect challenge
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      console.log('  🔑 Got challenge, sending connect...');
      this._sendConnect(msg.payload);
      return;
    }

    // Handle response to our connect request
    if (msg.type === 'res' && msg.id === 'connect-1') {
      if (msg.ok) {
        console.log('  ✅ Gateway connected! Protocol:', msg.payload?.protocol);
        this.connected = true;
      } else {
        console.error('  ❌ Connect failed:', msg.error);
      }
      return;
    }

    // Handle RPC responses
    if (msg.type === 'res' && this.pendingRequests.has(msg.id)) {
      const req = this.pendingRequests.get(msg.id);
      this.pendingRequests.delete(msg.id);
      clearTimeout(req.timeout);
      if (msg.ok) {
        req.resolve(msg.payload);
      } else {
        req.reject(new Error(msg.error?.message || JSON.stringify(msg.error) || 'RPC failed'));
      }
      return;
    }

    // Handle events (chat, agent, etc.)
    if (msg.type === 'event') {
      const handlers = this.eventHandlers.get(msg.event);
      if (handlers) {
        for (const handler of handlers) {
          handler(msg.payload, msg);
        }
      }
      // Also emit to wildcard handlers
      const wildcardHandlers = this.eventHandlers.get('*');
      if (wildcardHandlers) {
        for (const handler of wildcardHandlers) {
          handler(msg.payload, msg);
        }
      }
      return;
    }
  }

  _sendConnect(challenge) {
    // Use valid gateway client IDs and modes from OpenClaw schema
    // allowInsecureAuth=true lets us skip device identity
    this.ws.send(JSON.stringify({
      type: 'req',
      id: 'connect-1',
      method: 'connect',
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: 'gateway-client',
          displayName: 'agent-arena',
          version: '1.0.0',
          platform: process.platform,
          mode: 'backend',
          instanceId: crypto.randomUUID(),
        },
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        caps: ['tool-events'],
        auth: { token: this.token },
      },
    }));
  }

  // Send an RPC request and return a promise
  request(method, params = {}, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected to gateway'));
        return;
      }
      const id = `req-${++this.reqIdCounter}`;
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${method} timed out`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }

  // Subscribe to events
  on(event, handler) {
    if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, new Set());
    this.eventHandlers.get(event).add(handler);
    return () => this.eventHandlers.get(event)?.delete(handler);
  }

  destroy() {
    clearTimeout(this.reconnectTimer);
    if (this.ws) this.ws.close();
  }
}

// Single gateway connection shared by all clients
let gateway = null;
if (GATEWAY_TOKEN) {
  gateway = new GatewayConnection(GATEWAY_TOKEN);
}

// ============================================================
// HTTP Server
// ============================================================

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // API: registered agents (from gateway config) — must be before /api/agents/:name
  if (url.pathname === '/api/agents/registered') {
    try {
      const config = JSON.parse(fs.readFileSync(path.join(require('os').homedir(), '.openclaw/openclaw.json'), 'utf8'));
      const agentsList = (config.agents?.list || []).map(a => ({ id: a.id, name: a.name || a.id }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(agentsList));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
    }
    return;
  }

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
      agent.files = fs.readdirSync(path.join(PACKAGES, name)).filter(f => !f.startsWith('.'));
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

  // API: gateway status
  if (url.pathname === '/api/gateway/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ connected: gateway?.connected || false }));
    return;
  }

  // API: sessions — list active agent sessions from gateway
  if (url.pathname === '/api/sessions') {
    if (!gateway?.connected) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
      return;
    }
    try {
      const result = await gateway.request('sessions.list', { limit: 50 });
      const sessions = (result.sessions || result || []).map(s => ({
        key: s.key, kind: s.kind, label: s.label,
        updatedAt: s.updatedAt, model: s.model,
        agentId: s.key?.split(':')?.[1] || null,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sessions));
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
    }
    return;
  }

  // API: fire/uninstall agent
  const fireMatch = url.pathname.match(/^\/api\/agents\/([a-z0-9-]+)\/fire$/);
  if (fireMatch && req.method === 'POST') {
    const name = fireMatch[1];
    const manifestPath = path.join(PACKAGES, name, 'agent.json');
    if (!fs.existsSync(manifestPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Agent not found' }));
      return;
    }
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const agentId = manifest.agentId || name.replace(/-agent$/, '');
      
      // Remove from gateway config
      const configPath = path.join(require('os').homedir(), '.openclaw/openclaw.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.agents?.list) {
        config.agents.list = config.agents.list.filter(a => a.id !== agentId);
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      }
      
      // Restart gateway
      try { execSync('openclaw gateway restart', { timeout: 15000, encoding: 'utf8' }); } catch(e) {}
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, agentId }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Fire failed: ' + e.message }));
    }
    return;
  }

  // API: install agent (one-click from UI — multi-agent aware)
  const installMatch = url.pathname.match(/^\/api\/agents\/([a-z0-9-]+)\/install$/);
  if (installMatch && req.method === 'POST') {
    const name = installMatch[1];
    const pkgDir = path.join(PACKAGES, name);
    if (!fs.existsSync(path.join(pkgDir, 'agent.json'))) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Agent package not found' }));
      return;
    }
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'agent.json'), 'utf8'));
      const agentId = manifest.agentId || name.replace(/-agent$/, '');
      const home = require('os').homedir();
      const configPath = path.join(home, '.openclaw/openclaw.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

      // Check if already registered
      if (config.agents?.list?.some(a => a.id === agentId)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Already installed' }));
        return;
      }

      // Create dedicated workspace
      const workspacePath = path.join(home, `.openclaw/workspace-${agentId}`);
      if (!fs.existsSync(workspacePath)) fs.mkdirSync(workspacePath, { recursive: true });
      fs.mkdirSync(path.join(workspacePath, 'memory'), { recursive: true });

      // Copy agent files to workspace
      for (const f of ['SOUL.md', 'AGENTS.md', 'HEARTBEAT.md', 'MEMORY.md', 'USER.md', 'TOOLS.md', 'BOOTSTRAP.md']) {
        const src = path.join(pkgDir, f);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(workspacePath, f));
        }
      }

      // Add to agents.list in config
      if (!config.agents) config.agents = {};
      if (!config.agents.list) config.agents.list = [];
      config.agents.list.push({
        id: agentId,
        name: manifest.displayName || name,
        workspace: workspacePath,
        subagents: { allowAgents: ['*'] },
      });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      // Restart gateway to pick up new agent
      try { execSync('openclaw gateway restart', { timeout: 15000, encoding: 'utf8' }); } catch(e) {}

      console.log(`  ✅ Installed ${manifest.displayName || name} (${agentId}) → ${workspacePath}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, agentId }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Install failed: ' + e.message }));
    }
    return;
  }

  // API: agent detail — sessions + recent history for an agent
  const agentDetailMatch = url.pathname.match(/^\/api\/agents\/([a-z0-9-]+)\/activity$/);
  if (agentDetailMatch) {
    const agentName = agentDetailMatch[1];
    const agentId = agentName.replace(/-agent$/, '');
    if (!gateway?.connected) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions: [], history: [] }));
      return;
    }
    try {
      // Resolve actual agentId from package manifest (e.g. hopper-agent -> main)
      const manifestPath = path.join(PACKAGES, agentName, 'agent.json');
      let resolvedId = agentId;
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (manifest.agentId) resolvedId = manifest.agentId;
      }

      // Get all sessions for this agent
      const result = await gateway.request('sessions.list', { limit: 50 });
      const allSessions = result.sessions || result || [];
      const agentSessions = allSessions.filter(s => {
        const sAgent = s.key?.split(':')?.[1];
        return sAgent === resolvedId || sAgent === agentId || sAgent === agentName;
      });

      // Get history from the main session
      const mainSession = agentSessions.find(s => s.key === `agent:${resolvedId}:main`) || agentSessions.find(s => s.key === `agent:${agentId}:main`) || agentSessions[0];
      // Read history from session files on disk
      let history = [];
      const agentDir = path.join(require('os').homedir(), '.openclaw', 'agents', resolvedId, 'sessions');
      if (fs.existsSync(agentDir)) {
        // Find most recent session file
        const files = fs.readdirSync(agentDir)
          .filter(f => f.endsWith('.jsonl') && !f.includes('.deleted'))
          .map(f => ({ name: f, mtime: fs.statSync(path.join(agentDir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        
        if (files.length > 0) {
          try {
            const content = fs.readFileSync(path.join(agentDir, files[0].name), 'utf8');
            const lines = content.trim().split('\n').slice(-100); // last 100 lines
            for (const line of lines) {
              try {
                const entry = JSON.parse(line);
                if (entry.type === 'message' && entry.message) {
                  const msg = entry.message;
                  const role = msg.role || 'unknown';
                  // Extract text content
                  let text = '';
                  let toolCalls = [];
                  if (typeof msg.content === 'string') {
                    text = msg.content;
                  } else if (Array.isArray(msg.content)) {
                    text = msg.content.filter(c => c.type === 'text').map(c => c.text).join('');
                    toolCalls = msg.content.filter(c => c.type === 'tool_use').map(c => ({
                      name: c.name, input: typeof c.input === 'string' ? c.input : JSON.stringify(c.input || {}).slice(0, 300)
                    }));
                  }
                  if (text || toolCalls.length) {
                    history.push({ role, text, toolCalls, timestamp: entry.timestamp });
                  }
                }
              } catch(e) { /* skip bad line */ }
            }
          } catch(e) { /* can't read file */ }
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        agentId,
        sessions: agentSessions.map(s => ({
          key: s.key, kind: s.kind, label: s.label,
          updatedAt: s.updatedAt, model: s.model,
        })),
        history,
      }));
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions: [], history: [], error: e.message }));
    }
    return;
  }

  // API: activity feed — recent session events from gateway
  if (url.pathname === '/api/activity') {
    if (!gateway?.connected) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
      return;
    }
    try {
      const result = await gateway.request('sessions.list', { limit: 20 });
      const sessionList = result.sessions || result || [];
      const activity = [];
      for (const s of sessionList) {
        const agentId = s.key?.split(':')?.[1] || 'unknown';
        activity.push({
          type: 'session',
          agentId,
          sessionKey: s.key,
          kind: s.kind,
          label: s.label,
          updatedAt: s.updatedAt,
          model: s.model,
        });
      }
      // Sort by most recent
      activity.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(activity));
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
    }
    return;
  }

  // API: signup
  if ((url.pathname === '/api/signup' || url.pathname === '/api/waitlist') && req.method === 'POST') {
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
        fs.appendFileSync(signupsFile, JSON.stringify({ email, agent, timestamp: timestamp || new Date().toISOString() }) + '\n');
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

// ============================================================
// WebSocket Server — bridges browser clients to gateway
// ============================================================

const wss = new WebSocket.Server({ server });

wss.on('connection', (clientWs) => {
  // Use a stable client ID per browser (sent by client), or fallback to random
  let clientId = null;
  const eventCleanups = []; // track event subscriptions for cleanup
  const agentSessions = {}; // agentPkg -> sessionKey

  // Send gateway connection status
  clientWs.send(JSON.stringify({ 
    type: 'status', 
    connected: gateway?.connected || false 
  }));

  clientWs.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // ---- IDENTIFY: client sends stable ID ----
      if (msg.type === 'identify') {
        clientId = msg.clientId || crypto.randomBytes(4).toString('hex');
        console.log(`  [ws] Client identified: ${clientId}`);
        return;
      }

      if (!clientId) clientId = crypto.randomBytes(4).toString('hex');

      // ---- HATCH: create a new agent session ----
      if (msg.type === 'hatch') {
        if (!gateway?.connected) {
          clientWs.send(JSON.stringify({ type: 'error', error: 'Not connected to gateway' }));
          return;
        }

        const pkgDir = path.join(PACKAGES, msg.agentPkg);
        if (!fs.existsSync(path.join(pkgDir, 'agent.json'))) {
          clientWs.send(JSON.stringify({ type: 'error', error: 'Agent package not found' }));
          return;
        }

        const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'agent.json'), 'utf8'));
        const soul = fs.existsSync(path.join(pkgDir, 'SOUL.md'))
          ? fs.readFileSync(path.join(pkgDir, 'SOUL.md'), 'utf8') : '';
        const bootstrap = fs.existsSync(path.join(pkgDir, 'BOOTSTRAP.md'))
          ? fs.readFileSync(path.join(pkgDir, 'BOOTSTRAP.md'), 'utf8') : '';

        // Create session key targeting the correct agent
        // Session key format: agent:<agentId>:<scope>:<unique>
        // This ensures the right agent (with its own workspace/SOUL) handles the session
        const agentId = manifest.agentId || msg.agentPkg.replace(/-agent$/, '');
        const sessionKey = `agent:${agentId}:arena:hq-${clientId}`;
        agentSessions[msg.agentPkg] = sessionKey;

        console.log(`  🐣 [${clientId}] Hatching ${manifest.displayName} → ${sessionKey}`);

        // Subscribe to chat events for this session
        const cleanup = gateway.on('chat', (payload) => {
          if (payload.sessionKey !== sessionKey) return;
          
          if (payload.state === 'delta') {
            clientWs.send(JSON.stringify({
              type: 'chat-delta',
              agentPkg: msg.agentPkg,
              runId: payload.runId,
              message: payload.message,
              sessionKey,
            }));
          }
          
          if (payload.state === 'final') {
            clientWs.send(JSON.stringify({
              type: 'chat-final',
              agentPkg: msg.agentPkg,
              runId: payload.runId,
              message: payload.message,
              sessionKey,
            }));
          }
        });
        eventCleanups.push(cleanup);

        // Also subscribe to agent events (tool calls, etc.)
        const agentCleanup = gateway.on('agent', (payload) => {
          if (payload.sessionKey !== sessionKey) return;
          clientWs.send(JSON.stringify({
            type: 'agent-event',
            agentPkg: msg.agentPkg,
            payload,
          }));
        });
        eventCleanups.push(agentCleanup);

        // Send the boot message
        const bootMessage = `SYSTEM CONTEXT: You are ${manifest.displayName}. Adopt this persona completely:\n\n${soul}\n\n---\n\n${bootstrap}\n\nThis is your first boot. Introduce yourself in 3-5 punchy sentences. Show personality. Ask what to work on.`;

        try {
          const idempotencyKey = crypto.randomUUID();
          await gateway.request('chat.send', {
            sessionKey,
            message: bootMessage,
            idempotencyKey,
          });
          
          clientWs.send(JSON.stringify({ 
            type: 'hatch-ok', 
            agentPkg: msg.agentPkg,
            sessionKey,
            agent: manifest,
          }));
        } catch (e) {
          console.error(`  ❌ [${clientId}] Hatch failed:`, e.message);
          clientWs.send(JSON.stringify({ type: 'error', error: 'Hatch failed: ' + e.message }));
        }
      }

      // ---- CHAT: send a message to an existing agent session ----
      if (msg.type === 'chat') {
        if (!gateway?.connected) {
          clientWs.send(JSON.stringify({ type: 'error', error: 'Not connected to gateway' }));
          return;
        }

        let sessionKey = agentSessions[msg.agentPkg] || msg.sessionKey;
        
        // If we have a sessionKey but haven't subscribed to events yet, do it now
        if (sessionKey && !agentSessions[msg.agentPkg]) {
          agentSessions[msg.agentPkg] = sessionKey;
          const cleanup = gateway.on('chat', (payload) => {
            if (payload.sessionKey !== sessionKey) return;
            if (payload.state === 'delta') {
              clientWs.send(JSON.stringify({ type: 'chat-delta', agentPkg: msg.agentPkg, runId: payload.runId, message: payload.message, sessionKey }));
            }
            if (payload.state === 'final') {
              clientWs.send(JSON.stringify({ type: 'chat-final', agentPkg: msg.agentPkg, runId: payload.runId, message: payload.message, sessionKey }));
            }
          });
          eventCleanups.push(cleanup);
          const agentCleanup = gateway.on('agent', (payload) => {
            if (payload.sessionKey !== sessionKey) return;
            clientWs.send(JSON.stringify({ type: 'agent-event', agentPkg: msg.agentPkg, payload }));
          });
          eventCleanups.push(agentCleanup);
          console.log(`  🔗 [${clientId}] Subscribed to existing session ${sessionKey}`);
        }

        // If no session exists yet, create one for this agent
        if (!sessionKey) {
          const agentId = msg.agentPkg?.replace(/-agent$/, '') || 'main';
          sessionKey = `agent:${agentId}:arena:hq-${clientId}`;
          agentSessions[msg.agentPkg] = sessionKey;
          
          // Subscribe to events for this new session
          const cleanup = gateway.on('chat', (payload) => {
            if (payload.sessionKey !== sessionKey) return;
            console.log(`  📨 [${clientId}] chat event: state=${payload.state} runId=${payload.runId} msgLen=${JSON.stringify(payload.message)?.length || 0}`);
            if (payload.state === 'delta') {
              clientWs.send(JSON.stringify({ type: 'chat-delta', agentPkg: msg.agentPkg, runId: payload.runId, message: payload.message, sessionKey }));
            }
            if (payload.state === 'final') {
              clientWs.send(JSON.stringify({ type: 'chat-final', agentPkg: msg.agentPkg, runId: payload.runId, message: payload.message, sessionKey }));
            }
          });
          eventCleanups.push(cleanup);
          const agentCleanup = gateway.on('agent', (payload) => {
            if (payload.sessionKey !== sessionKey) return;
            clientWs.send(JSON.stringify({ type: 'agent-event', agentPkg: msg.agentPkg, payload }));
          });
          eventCleanups.push(agentCleanup);
          
          console.log(`  🆕 [${clientId}] Auto-created session for ${msg.agentPkg} → ${sessionKey}`);
        }

        console.log(`  💬 [${clientId}] → ${msg.agentPkg}: ${(msg.message || '').slice(0, 60)}...`);

        try {
          const idempotencyKey = crypto.randomUUID();
          await gateway.request('chat.send', {
            sessionKey,
            message: msg.message,
            idempotencyKey,
          });
        } catch (e) {
          console.error(`  ❌ [${clientId}] Chat send failed:`, e.message);
          clientWs.send(JSON.stringify({ type: 'error', error: 'Send failed: ' + e.message }));
        }
      }

      // ---- HISTORY: load chat history for an agent ----
      if (msg.type === 'history') {
        const sessionKey = agentSessions[msg.agentPkg] || msg.sessionKey;
        if (!sessionKey) {
          clientWs.send(JSON.stringify({ type: 'history', messages: [] }));
          return;
        }
        try {
          const result = await gateway.request('chat.history', {
            sessionKey,
            limit: msg.limit || 50,
          });
          clientWs.send(JSON.stringify({ type: 'history', agentPkg: msg.agentPkg, messages: result }));
        } catch (e) {
          clientWs.send(JSON.stringify({ type: 'history', agentPkg: msg.agentPkg, messages: [], error: e.message }));
        }
      }

    } catch (e) {
      console.error(`  [ws] Client ${clientId} error:`, e.message);
    }
  });

  clientWs.on('close', () => {
    console.log(`  [ws] Client ${clientId} disconnected`);
    // Clean up event subscriptions
    for (const cleanup of eventCleanups) cleanup();
  });
});

// ============================================================

process.on('uncaughtException', (e) => { console.error('Uncaught:', e.message); });
process.on('unhandledRejection', (e) => { console.error('Unhandled:', e); });

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🦞 Agent Arena server running on http://localhost:${PORT}\n`);
  console.log(`  Endpoints:`);
  console.log(`    GET  /                    → Arena UI`);
  console.log(`    GET  /api/agents          → List all agents`);
  console.log(`    POST /api/chat            → (legacy) HTTP chat`);
  console.log(`    WS   ws://localhost:${PORT} → Real-time gateway bridge\n`);
  console.log(`  Gateway: ${gateway?.connected ? '✅ connected' : '⏳ connecting...'}\n`);
});
