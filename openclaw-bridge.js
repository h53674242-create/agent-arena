/**
 * Agent Arena ↔ OpenClaw Bridge
 * Connects our HQ UI to the local OpenClaw gateway via WebSocket.
 *
 * Usage:
 *   const bridge = new OpenClawBridge();
 *   bridge.connect().then(() => {
 *     bridge.sendMessage("Hello from Agent Arena!");
 *     bridge.onMessage((msg) => console.log('Agent:', msg));
 *   });
 */

class OpenClawBridge {
  constructor(opts = {}) {
    this.port = opts.port || 18789;
    this.token = opts.token || null;
    this.ws = null;
    this.connected = false;
    this.listeners = { message: [], status: [], error: [] };
    this.pendingCallbacks = {};
    this.callId = 0;
  }

  // Check if OpenClaw is running locally
  async detect() {
    try {
      const resp = await fetch(`http://127.0.0.1:${this.port}/`, {
        method: 'HEAD',
        mode: 'no-cors',
        signal: AbortSignal.timeout(2000),
      });
      return true;
    } catch {
      return false;
    }
  }

  // Connect to gateway WebSocket
  async connect() {
    return new Promise((resolve, reject) => {
      const params = this.token ? `?token=${this.token}` : '';
      const url = `ws://127.0.0.1:${this.port}/${params}`;

      try {
        this.ws = new WebSocket(url);
      } catch (e) {
        reject(new Error('Could not create WebSocket connection'));
        return;
      }

      this.ws.onopen = () => {
        this.connected = true;
        this._emit('status', { connected: true });

        // Authenticate if token provided
        if (this.token) {
          this._send({
            type: 'connect',
            params: { auth: { token: this.token } }
          });
        }

        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this._handleMessage(data);
        } catch (e) {
          // Non-JSON message
        }
      };

      this.ws.onerror = (err) => {
        this._emit('error', err);
        if (!this.connected) reject(new Error('WebSocket connection failed'));
      };

      this.ws.onclose = () => {
        this.connected = false;
        this._emit('status', { connected: false });
      };

      // Timeout
      setTimeout(() => {
        if (!this.connected) {
          this.ws.close();
          reject(new Error('Connection timeout'));
        }
      }, 5000);
    });
  }

  // Send a chat message
  sendMessage(text, sessionKey) {
    const id = ++this.callId;
    this._send({
      id,
      method: 'chat.send',
      params: {
        message: text,
        ...(sessionKey ? { sessionKey } : {}),
      }
    });
    return id;
  }

  // Get chat history
  getHistory(sessionKey, limit = 50) {
    return this._call('chat.history', {
      ...(sessionKey ? { sessionKey } : {}),
      limit,
    });
  }

  // List sessions
  listSessions() {
    return this._call('sessions.list', {});
  }

  // Subscribe to messages
  onMessage(callback) {
    this.listeners.message.push(callback);
  }

  onStatus(callback) {
    this.listeners.status.push(callback);
  }

  onError(callback) {
    this.listeners.error.push(callback);
  }

  // Disconnect
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }

  // Internal: make an RPC call and wait for response
  _call(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.callId;
      this.pendingCallbacks[id] = { resolve, reject };
      this._send({ id, method, params });
      setTimeout(() => {
        if (this.pendingCallbacks[id]) {
          delete this.pendingCallbacks[id];
          reject(new Error(`Timeout waiting for ${method}`));
        }
      }, 10000);
    });
  }

  _send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  _handleMessage(data) {
    // RPC response
    if (data.id && this.pendingCallbacks[data.id]) {
      const cb = this.pendingCallbacks[data.id];
      delete this.pendingCallbacks[data.id];
      if (data.error) cb.reject(new Error(data.error.message || 'RPC error'));
      else cb.resolve(data.result);
      return;
    }

    // Chat event (streaming message from agent)
    if (data.type === 'chat' || data.method === 'chat') {
      this._emit('message', data);
      return;
    }

    // Agent event
    if (data.type === 'agent' || data.event) {
      this._emit('message', data);
    }
  }

  _emit(type, data) {
    (this.listeners[type] || []).forEach(cb => cb(data));
  }
}

// Export for use in browser
if (typeof window !== 'undefined') {
  window.OpenClawBridge = OpenClawBridge;
}
if (typeof module !== 'undefined') {
  module.exports = OpenClawBridge;
}
