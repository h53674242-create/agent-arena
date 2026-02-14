#!/usr/bin/env bash
# Safe test installer — installs to /tmp, doesn't touch your real workspace
# Usage: bash test-install.sh [agent-name]

AGENT="${1:-founder-agent}"
export OPENCLAW_WORKSPACE="/tmp/huddleclaw-test-workspace"
export SKIP_RESTART=1

rm -rf "$OPENCLAW_WORKSPACE"
mkdir -p "$OPENCLAW_WORKSPACE"

echo ""
echo "🧪 TEST MODE — installing to: $OPENCLAW_WORKSPACE"
echo "   Your real workspace is NOT touched."
echo ""

cd "$(dirname "$0")"
bash installer/install.sh "$AGENT"

echo ""
echo "📂 Installed files:"
echo "---"
ls -la "$OPENCLAW_WORKSPACE"
echo ""
echo "📄 SOUL.md preview:"
echo "---"
head -5 "$OPENCLAW_WORKSPACE/SOUL.md"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Installation complete!"
echo ""
echo "👉 Go back to your OpenClaw chat and say:"
echo "   \"Start my new agent\""
echo ""
echo "   Your agent will introduce itself and you can"
echo "   start chatting with it immediately."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🧹 To clean up: rm -rf $OPENCLAW_WORKSPACE"
echo ""
