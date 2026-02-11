#!/usr/bin/env bash
set -euo pipefail

# Agent Arena Installer
# Usage: curl -fsSL https://agent-arena.sh/install | sh -s <agent-name>
#   or:  ./install.sh <agent-name> [--from <path-or-url>]

VERSION="0.1.0"
WORKSPACE="${OPENCLAW_WORKSPACE:-$HOME/.openclaw/workspace}"
BACKUP_DIR="$WORKSPACE/.agent-arena-backup/$(date +%Y%m%d-%H%M%S)"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'
BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'

banner() {
  echo ""
  echo -e "${YELLOW}${BOLD}  ⚡ AGENT ARENA ⚡${RESET}"
  echo -e "${DIM}  Hire AI. Ship Product. v${VERSION}${RESET}"
  echo ""
}

info()  { echo -e "  ${CYAN}→${RESET} $1"; }
ok()    { echo -e "  ${GREEN}✓${RESET} $1"; }
warn()  { echo -e "  ${YELLOW}!${RESET} $1"; }
fail()  { echo -e "  ${RED}✗${RESET} $1"; exit 1; }

# Parse args
AGENT_NAME="${1:-}"
SOURCE_PATH=""
while [[ $# -gt 1 ]]; do
  case "$2" in
    --from) SOURCE_PATH="$3"; shift 2 ;;
    *) shift ;;
  esac
done

[[ -z "$AGENT_NAME" ]] && fail "Usage: install.sh <agent-name> [--from <path>]"

banner

# Resolve source
if [[ -n "$SOURCE_PATH" ]]; then
  PACKAGE_DIR="$SOURCE_PATH"
elif [[ -d "./$AGENT_NAME" ]]; then
  PACKAGE_DIR="./$AGENT_NAME"
elif [[ -d "./packages/$AGENT_NAME" ]]; then
  PACKAGE_DIR="./packages/$AGENT_NAME"
else
  # Download from GitHub
  REPO_URL="https://github.com/h53674242-create/agent-arena"
  info "Downloading ${AGENT_NAME} from Agent Arena..."
  TMP_DIR=$(mktemp -d)
  trap "rm -rf $TMP_DIR" EXIT
  if command -v curl &>/dev/null; then
    curl -fsSL "${REPO_URL}/archive/refs/heads/main.tar.gz" -o "$TMP_DIR/repo.tar.gz" || fail "Could not download from Agent Arena"
    tar -xzf "$TMP_DIR/repo.tar.gz" -C "$TMP_DIR" || fail "Could not extract archive"
    PACKAGE_DIR="$TMP_DIR/agent-arena-main/packages/$AGENT_NAME"
  elif command -v git &>/dev/null; then
    git clone --depth 1 "$REPO_URL" "$TMP_DIR/repo" 2>/dev/null || fail "Could not download agent"
    PACKAGE_DIR="$TMP_DIR/repo/packages/$AGENT_NAME"
  else
    fail "curl or git required. Install either and try again."
  fi
fi

[[ ! -f "$PACKAGE_DIR/agent.json" ]] && fail "Not a valid agent package: agent.json not found in $PACKAGE_DIR"
[[ ! -f "$PACKAGE_DIR/SOUL.md" ]] && fail "Not a valid agent package: SOUL.md not found"

# Read manifest
DISPLAY_NAME=$(python3 -c "import json; print(json.load(open('$PACKAGE_DIR/agent.json'))['displayName'])" 2>/dev/null || echo "$AGENT_NAME")
EMOJI=$(python3 -c "import json; print(json.load(open('$PACKAGE_DIR/agent.json'))['emoji'])" 2>/dev/null || echo "🤖")
TITLE=$(python3 -c "import json; print(json.load(open('$PACKAGE_DIR/agent.json'))['title'])" 2>/dev/null || echo "")

echo -e "  ${BOLD}${EMOJI} ${DISPLAY_NAME}${RESET} — ${DIM}${TITLE}${RESET}"
echo ""

# Check OpenClaw workspace
[[ ! -d "$WORKSPACE" ]] && { info "Creating workspace at $WORKSPACE"; mkdir -p "$WORKSPACE"; }

# Backup existing files
NEEDS_BACKUP=false
for f in SOUL.md AGENTS.md TOOLS.md HEARTBEAT.md MEMORY.md; do
  [[ -f "$WORKSPACE/$f" ]] && NEEDS_BACKUP=true && break
done

if $NEEDS_BACKUP; then
  warn "Existing workspace files found — backing up to .agent-arena-backup/"
  mkdir -p "$BACKUP_DIR"
  for f in SOUL.md AGENTS.md TOOLS.md HEARTBEAT.md MEMORY.md USER.md; do
    [[ -f "$WORKSPACE/$f" ]] && cp "$WORKSPACE/$f" "$BACKUP_DIR/$f"
  done
  ok "Backup saved to $BACKUP_DIR"
fi

# Copy agent files
info "Installing agent files..."
for f in SOUL.md AGENTS.md HEARTBEAT.md MEMORY.md; do
  if [[ -f "$PACKAGE_DIR/$f" ]]; then
    cp "$PACKAGE_DIR/$f" "$WORKSPACE/$f"
    ok "$f"
  fi
done

# Don't overwrite TOOLS.md or USER.md — those are personal
for f in TOOLS.md USER.md; do
  if [[ -f "$PACKAGE_DIR/$f" ]] && [[ ! -f "$WORKSPACE/$f" ]]; then
    cp "$PACKAGE_DIR/$f" "$WORKSPACE/$f"
    ok "$f (new)"
  elif [[ -f "$PACKAGE_DIR/$f" ]]; then
    info "$f already exists — skipping (your personal config is preserved)"
  fi
done

# Copy workspace starter files
if [[ -d "$PACKAGE_DIR/workspace" ]]; then
  info "Installing starter workspace files..."
  cp -rn "$PACKAGE_DIR/workspace/" "$WORKSPACE/" 2>/dev/null || true
  ok "Workspace files"
fi

# Create memory dir
mkdir -p "$WORKSPACE/memory"
ok "memory/ directory"

# Check skill dependencies
info "Checking skill dependencies..."
OPENCLAW_SKILLS="$(npm root -g 2>/dev/null)/openclaw/skills"
SKILLS=$(python3 -c "import json; [print(s) for s in json.load(open('$PACKAGE_DIR/agent.json')).get('skills', [])]" 2>/dev/null || true)

for skill in $SKILLS; do
  if [[ -d "$OPENCLAW_SKILLS/$skill" ]]; then
    ok "$skill (bundled ✓)"
  else
    warn "$skill not found — you may need to install it"
  fi
done

# ClawHub skills
CH_SKILLS=$(python3 -c "import json; [print(s) for s in json.load(open('$PACKAGE_DIR/agent.json')).get('clawhubSkills', [])]" 2>/dev/null || true)
for skill in $CH_SKILLS; do
  info "Installing $skill from ClawHub..."
  if npx clawhub@latest install "$skill" 2>/dev/null; then
    ok "$skill installed"
  else
    warn "Could not install $skill — install manually: npx clawhub@latest install $skill"
  fi
done

# Store agent metadata
mkdir -p "$WORKSPACE/.agent-arena"
cp "$PACKAGE_DIR/agent.json" "$WORKSPACE/.agent-arena/current-agent.json"
ok "Agent metadata saved"

# Restart gateway if running
echo ""
if [[ -z "${SKIP_RESTART:-}" ]] && command -v openclaw &>/dev/null; then
  info "Restarting OpenClaw gateway..."
  if timeout 10 openclaw gateway restart 2>/dev/null; then
    ok "Gateway restarted"
  else
    warn "Could not restart gateway — run 'openclaw gateway restart' manually"
  fi
else
  [[ -n "${SKIP_RESTART:-}" ]] && info "Skipping gateway restart (test mode)"
  [[ -z "${SKIP_RESTART:-}" ]] && warn "OpenClaw CLI not found — make sure it's installed"
fi

echo ""
echo -e "  ${GREEN}${BOLD}${EMOJI} ${DISPLAY_NAME} is ready!${RESET}"
echo ""

# Check if OpenClaw is running
if command -v openclaw &>/dev/null; then
  GATEWAY_STATUS=$(openclaw gateway status 2>/dev/null || echo "not running")
  if echo "$GATEWAY_STATUS" | grep -qi "running\|active\|ok"; then
    echo -e "  ${GREEN}✓${RESET} OpenClaw detected and running!"
    echo ""
    echo -e "  ${BOLD}Your agent is live.${RESET} Open your chat (Telegram, webchat, etc.)"
    echo -e "  and say hello — your new agent is waiting to introduce itself."
    echo ""
    echo -e "  ${DIM}To switch back to your previous agent:${RESET}"
    echo -e "  ${DIM}  cp $BACKUP_DIR/* $WORKSPACE/ && openclaw gateway restart${RESET}"
  else
    echo -e "  ${YELLOW}!${RESET} OpenClaw is installed but the gateway isn't running."
    echo -e "    Start it with: ${BOLD}openclaw gateway start${RESET}"
    echo -e "    Then open your chat and say hello to your new agent!"
  fi
else
  echo ""
  echo -e "  ${YELLOW}!${RESET} OpenClaw not found on this machine."
  echo -e "    Install it first: ${BOLD}https://openclaw.ai${RESET}"
  echo -e "    Then run: ${BOLD}openclaw gateway start${RESET}"
  echo -e "    Your agent files are ready — they'll come alive once OpenClaw is running."
fi

echo ""
echo -e "  ${DIM}Files backed up to: $BACKUP_DIR${RESET}"
echo -e "  ${DIM}To restore: cp $BACKUP_DIR/* $WORKSPACE/${RESET}"
echo ""
echo -e "  ${YELLOW}${BOLD}  Happy shipping! 🚀${RESET}"
echo ""
