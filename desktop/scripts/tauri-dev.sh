#!/usr/bin/env bash
# tauri-dev.sh — 一键启动/清理/验证 CyberCode Tauri dev
# 用法:
#   bash desktop/scripts/tauri-dev.sh           # 启动 + 验证
#   bash desktop/scripts/tauri-dev.sh --clean   # 先清理僵尸窗口，再启动
#   bash desktop/scripts/tauri-dev.sh --verify  # 仅验证当前状态
set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
warn() { echo -e "  ${YELLOW}~${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DESKTOP_DIR="$REPO_ROOT/desktop"
SIDECAR_BIN="$DESKTOP_DIR/src-tauri/target/debug/cybercode-desktop"

# ── cleanup ──────────────────────────────────────────────
do_cleanup() {
  echo "=== Cleaning up ==="

  # Kill running processes
  pkill -9 -f "cybercode-desktop|cybercode-sidecar" 2>/dev/null || true
  pkill -9 -f "vite" 2>/dev/null || true
  sleep 1

  # Free ports
  for port in 1420 1421 3456; do
    lsof -ti ":$port" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  done

  # Destroy X11 zombie windows
  WIDS=$(xwininfo -root -tree 2>/dev/null | grep -oP '0x[0-9a-f]+(?=.*"CyberCode")' || true)
  if [ -n "$WIDS" ]; then
    echo "$WIDS" | while read wid; do
      pid=$(xprop -id "$wid" _NET_WM_PID 2>/dev/null | grep -oP '\d+')
      [ -n "$pid" ] && kill -9 "$pid" 2>/dev/null
    done
  fi

  # Also use Python for thorough cleanup
  python3 "$SCRIPT_DIR/cleanup-tauri-windows.py" --all 2>/dev/null || true

  sleep 1
  echo "  Cleaned: $(xwininfo -root -tree 2>/dev/null | grep -c CyberCode || echo 0) windows remain"
}

# ── verify ───────────────────────────────────────────────
do_verify() {
  echo ""
  echo "=== Verifying ==="

  local ok=0

  # Vite
  if ss -tlnp 2>/dev/null | grep -q '127.0.0.1:1420'; then
    pass "Vite on :1420"
  else
    fail "Vite NOT on :1420"; ok=1
  fi

  # Server
  SERVER_PORT=$(ss -tlnp 2>/dev/null | grep 'cybercode-sidec' | awk '{print $4}' | grep -oP '(?<=:)\d+' | head -1)
  if [ -n "$SERVER_PORT" ]; then
    pass "Server on :$SERVER_PORT"
    if curl -sf "http://127.0.0.1:$SERVER_PORT/health" > /dev/null 2>&1; then
      pass "Health OK (:$SERVER_PORT/health)"
    else
      fail "Health FAILED (:$SERVER_PORT/health)"; ok=1
    fi
  else
    fail "No server sidecar"; ok=1
  fi

  # Windows
  WCOUNT=$(xwininfo -root -tree 2>/dev/null | grep -c '"CyberCode"' | tr -d '\n')
  WCOUNT=${WCOUNT:-0}
  if [ "$WCOUNT" -gt 0 ] 2>/dev/null; then
    pass "$WCOUNT CyberCode window(s)"
    xwininfo -root -tree 2>/dev/null | grep '"CyberCode"' | awk '{print $1}' | while read wid; do
      MAP=$(xwininfo -id "$wid" 2>/dev/null | grep "Map State" | awk '{print $NF}')
      SIZE=$(xwininfo -id "$wid" 2>/dev/null | grep -oP '\d+x\d+' | head -1)
      [ "$MAP" = "IsViewable" ] && pass "  $wid ${SIZE}" || warn "  $wid ${SIZE} — $MAP"
    done
  else
    warn "No CyberCode windows — check HDMI monitor (top-left)"
  fi

  # Zombies
  ZOMBIES=0
  xwininfo -root -tree 2>/dev/null | grep '"CyberCode"' | awk '{print $1}' | while read wid; do
    pid=$(xprop -id "$wid" _NET_WM_PID 2>/dev/null | grep -oP '\d+')
    [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null && echo "  zombie: $wid"
  done
  [ "$ZOMBIES" -eq 0 ] && pass "No zombie windows"

  if [ "$ok" -eq 0 ]; then
    echo ""
    echo -e "${GREEN}Tauri dev is healthy${NC}"
    echo "  Frontend: http://127.0.0.1:1420/"
    [ -n "${SERVER_PORT:-}" ] && echo "  Server:   http://127.0.0.1:$SERVER_PORT"
    echo ""
    echo "  Chrome workaround:"
    echo "  http://127.0.0.1:1420/?serverUrl=http://127.0.0.1:${SERVER_PORT:-3456}"
  fi

  return $ok
}

# ── main ─────────────────────────────────────────────────
case "${1:-}" in
  --clean)
    do_cleanup
    ;&
  --verify-only)
    do_verify
    exit
    ;;
  --verify)
    do_verify
    exit
    ;;
esac

do_cleanup

echo ""
echo "=== Starting Tauri dev ==="
cd "$DESKTOP_DIR"

# Setup env
export PATH="$HOME/.bun/bin:$PATH"
source ~/.nvm/nvm.sh 2>/dev/null
nvm use 22.23.1 2>/dev/null || true

echo "Starting (logs → /tmp/tauri-dev.log)..."
bun run tauri dev > /tmp/tauri-dev.log 2>&1 &
TAURI_PID=$!

# Wait for Vite
echo -n "Waiting for Vite"
for i in $(seq 1 30); do
  sleep 2
  echo -n "."
  if ss -tlnp 2>/dev/null | grep -q '127.0.0.1:1420'; then
    echo " ready"
    break
  fi
done

# Wait for server
echo -n "Waiting for server"
for i in $(seq 1 15); do
  sleep 2
  echo -n "."
  if ss -tlnp 2>/dev/null | grep -q 'cybercode-sidec'; then
    echo " ready"
    break
  fi
done

do_verify
