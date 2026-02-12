
```
   ___                    __     ___                         
  / _ |  ___ ____ ___    / /_   / _ | ______ ___  ___ _     
 / __ | / _ `/ -_) _ \  / __/  / __ |/ __/ -_) _ \/ _ `/    
/_/ |_| \_, /\__/_//_/  \__/  /_/ |_/_/  \__/_//_/\_,_/     
       /___/                                                  
```

# 🏟️ Agent Arena

**The marketplace to hire pre-configured AI agents for [OpenClaw](https://github.com/openclaw/openclaw).**

Browse agents. Pick one. Install in 10 seconds. Done.

[![Live Site](https://img.shields.io/badge/🌐_Live_Site-Agent_Arena-blue?style=for-the-badge)](https://h53674242-create.github.io/agent-arena/)
[![Built on OpenClaw](https://img.shields.io/badge/Built_on-OpenClaw-black?style=for-the-badge)](https://github.com/openclaw/openclaw)

---

<!-- TODO: Add demo GIF -->
<p align="center">
  <img src="assets/demo.gif" alt="Agent Arena Demo" width="700" />
  <br />
  <em>👆 Demo coming soon — imagine the magic here</em>
</p>

---

## ✨ Features

- 🛒 **One-command install** — `curl | sh` and your agent is ready
- 🧠 **Real AI agents** — not wrappers; each has its own soul, memory, and tools
- 🔒 **100% local** — agents run on your machine, your data never leaves
- 🏗️ **Multi-agent architecture** — agents get their own workspace and context
- 💰 **Creator marketplace** — build agents, earn 80% revenue share
- ⚡ **Powered by OpenClaw** — gateway protocol, skills, and the full agent runtime

---

## 🚀 Quick Start

```bash
# Install any agent in one command
curl -fsSL raw.githubusercontent.com/h53674242-create/agent-arena/main/installer/install.sh | sh -s <agent-name>

# Example: install the Founder agent (free!)
curl -fsSL raw.githubusercontent.com/h53674242-create/agent-arena/main/installer/install.sh | sh -s founder
```

That's it. The agent installs into OpenClaw, gets its own workspace, and is ready to chat.

---

## 📦 Agent Catalog

| Agent | Price | Description |
|-------|-------|-------------|
| 🧑‍💼 **Founder** | Free | Your startup co-pilot. Strategy, planning, product thinking. Great first agent. |
| 🎨 **Creator** | $8/mo | Content, copywriting, social media, and creative workflows. |
| ⚙️ **DevOps** | $10/mo | Infrastructure, CI/CD, monitoring, and deployment automation. |

> More agents coming soon — or [build your own](#-for-creators).

---

## 🔧 How It Works

```
┌─────────────┐     curl install     ┌──────────────┐
│ Agent Arena  │ ──────────────────▸  │  Your Machine │
│  (catalog)   │                      │               │
└─────────────┘                      │  ┌──────────┐ │
                                     │  │ OpenClaw  │ │
                                     │  │ Gateway   │ │
                                     │  └────┬─────┘ │
                                     │       │       │
                                     │  ┌────▾─────┐ │
                                     │  │  Agent    │ │
                                     │  │ Workspace │ │
                                     │  │ Soul·Mem  │ │
                                     │  └──────────┘ │
                                     └───────────────┘
```

1. **Browse** the catalog on the [live site](https://h53674242-create.github.io/agent-arena/)
2. **Install** with one `curl` command — the installer configures everything
3. **Agent boots** inside OpenClaw with its own workspace, soul file, memory, and tools
4. **Chat** via any connected channel — webchat, Discord, terminal, etc.

Each agent is a fully isolated OpenClaw agent: own `SOUL.md`, own `memory/`, own skills. They don't share state unless you want them to.

---

## 🎨 For Creators

Build an agent. Publish it. Earn **80% of every subscription**.

### Why build on Agent Arena?

- 💸 **80% revenue share** — you keep the lion's share
- 📦 **Simple format** — it's just a folder with config files
- 🌍 **Distribution** — your agent shows up in the marketplace instantly
- 🔧 **OpenClaw runtime** — no infra to manage, agents run on user machines

### How to submit

1. Fork this repo
2. Create your agent in `agents/<your-agent-name>/`
3. Include: `SOUL.md`, `config.yaml`, and any skills or tools
4. Open a PR — we review and list it

> Full creator docs coming soon. Join the Discord to get early access.

---

## 🏗️ Architecture

Agent Arena is built on **[OpenClaw](https://github.com/openclaw/openclaw)** — an open-source multi-agent framework.

| Layer | What it does |
|-------|-------------|
| **Gateway** | Routes messages between channels and agents via the OpenClaw protocol |
| **Agent Runtime** | Each agent runs as an isolated OpenClaw session with full tool access |
| **Workspace** | Every agent has its own filesystem workspace (`SOUL.md`, `memory/`, skills) |
| **Skills** | Modular tool packs — browser, code execution, web search, TTS, and more |
| **Channels** | Webchat, Discord, WhatsApp, Telegram — plug in any interface |

Everything runs **locally on your machine**. No cloud. No telemetry. Your agents, your data.

---

## 🔗 Links

- 🌐 **Live Site:** [agent-arena](https://h53674242-create.github.io/agent-arena/)
- 📖 **OpenClaw:** [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw)
- 💬 **Discord:** [Join the community](https://discord.gg/openclaw)
- 🐛 **Issues:** [Report bugs](https://github.com/h53674242-create/agent-arena/issues)

---

<p align="center">
  <strong>Built with 🦞 by the Agent Arena community</strong>
  <br />
  <sub>Powered by OpenClaw · Agents run local · Your data stays yours</sub>
</p>
