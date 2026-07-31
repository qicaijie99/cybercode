#!/usr/bin/env bash
# verify-tauri-dev.sh — 验证 Tauri dev 是否正常启动
# 用法: ./desktop/scripts/verify-tauri-dev.sh
set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
warn() { echo -e "  ${YELLOW}~${NC} $1"; }

echo "=== CyberCode Tauri Dev Verification ==="

# 1. Vite port
if ss -tlnp 2>/dev/null | grep -q 127.0.0.1:1420; then
  pass "Vite listening on :1420"
else
  fail "Vite NOT listening on :1420"
fi

# 2. Server port (any cybercode-sidecar on 127.0.0.1)
SERVER_PORT=$(ss -tlnp 2>/dev/null | grep 'cybercode-sidec' | awk '{print $4}' | grep -oP '(?<=:)\d+' | head -1)
if [ -n "$SERVER_PORT" ]; then
  pass "Server sidecar listening on :$SERVER_PORT"

  # 3. Health check
  if curl -sf "http://127.0.0.1:$SERVER_PORT/health" > /dev/null 2>&1; then
    pass "Health endpoint OK (:$SERVER_PORT/health)"
  else
    fail "Health endpoint FAILED (:$SERVER_PORT/health)"
  fi
else
  fail "No server sidecar listening"
fi

# 4. X11 windows
WINDOW_COUNT=$(xwininfo -root -tree 2>/dev/null | grep -c '"CyberCode"' | tr -d '\n' || echo 0)
WINDOW_COUNT=${WINDOW_COUNT:-0}
if [ "$WINDOW_COUNT" -gt 0 ] 2>/dev/null; then
  pass "$WINDOW_COUNT CyberCode window(s)"

  # Check each window's map state
  xwininfo -root -tree 2>/dev/null | grep '"CyberCode"' | awk '{print $1}' | while read wid; do
    MAP=$(xwininfo -id "$wid" 2>/dev/null | grep "Map State" | awk '{print $NF}')
    SIZE=$(xwininfo -id "$wid" 2>/dev/null | grep -oP '\d+x\d+' | head -1)
    if [ "$MAP" = "IsViewable" ]; then
      pass "  $wid ${SIZE} — $MAP"
    else
      warn "  $wid ${SIZE} — $MAP (not visible)"
    fi
  done
else
  warn "No CyberCode windows found (may be behind other windows)"
  warn "Check HDMI monitor top-left area; windows may be stacked"
fi

# 5. Zombie check
ZOMBIE_WINDOWS=$(xwininfo -root -tree 2>/dev/null | grep '"CyberCode"' | while read line; do
  wid=$(echo "$line" | awk '{print $1}')
  pid=$(xprop -id "$wid" _NET_WM_PID 2>/dev/null | awk '{print $NF}')
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
    echo "  zombie: $wid (PID $pid dead)"
  fi
done)
if [ -n "$ZOMBIE_WINDOWS" ]; then
  warn "Zombie windows detected:$ZOMBIE_WINDOWS"
  echo "  Clean with: python3 -c \"import Xlib.display; ...\" (see cleanup script)"
else
  pass "No zombie windows"
fi

echo "=== Done ==="
