# HuddleClaw — Package Specification v1

## Package Structure

```
agent-name/
├── agent.json        # Manifest (required)
├── SOUL.md           # Personality & behavior (required)
├── AGENTS.md         # Operating rules (required)
├── TOOLS.md          # Tool-specific notes (optional)
├── HEARTBEAT.md      # Periodic checks (optional)
├── MEMORY.md         # Starter memories (optional)
├── skills.json       # Skill dependencies (optional)
├── workspace/        # Starter workspace files (optional)
│   └── ...
└── README.md         # Marketplace listing (required)
```

## agent.json Manifest

```json
{
  "name": "founder-agent",
  "displayName": "Founder Agent",
  "version": "1.0.0",
  "emoji": "🚀",
  "title": "Technical Co-Founder",
  "description": "Ships products, manages repos, tracks metrics, handles comms.",
  "creator": "@hopper",
  "price": { "amount": 0, "currency": "USD", "interval": "one-time" },
  "skills": ["github", "caldav-calendar", "weather", "healthcheck"],
  "clawhubSkills": [],
  "tags": ["founder", "startup", "shipping", "product"],
  "stats": {
    "vibe_coding": 8,
    "shipping_speed": 9,
    "prd_writing": 7,
    "growth_hacking": 8,
    "telling_stakeholders_no": 6,
    "design": 7
  },
  "minOpenClawVersion": "0.1.0"
}
```

## Install Flow

1. Download/clone agent package
2. Validate agent.json
3. Backup existing workspace files (if any)
4. Copy SOUL.md, AGENTS.md, TOOLS.md, HEARTBEAT.md, MEMORY.md to workspace
5. Install skill dependencies (bundled = verify exists, clawhub = npx clawhub install)
6. Apply config patch if provided
7. Restart OpenClaw gateway
8. Agent sends first message
