#!/usr/bin/env bash
# Quản lý QLVB Mobile: ./qlvb.sh {start|stop|restart|status|logs|url}
# Cấu hình tuỳ chọn trong qlvb.conf (cùng thư mục):
#   PORT=8787          cổng chạy server
#   PUBLIC=ngrok       ngrok = mở ra Internet qua ngrok; none = chỉ chạy trong máy/mạng LAN
#   NGROK_URL=         để trống = dùng tên miền cố định (dev domain) của tài khoản ngrok
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN="$DIR/run"
mkdir -p "$RUN"

PORT=8787
PUBLIC=ngrok
NGROK_URL=
NGROK_API=127.0.0.1:4047
[ -f "$DIR/qlvb.conf" ] && . "$DIR/qlvb.conf"

SERVER_PID="$RUN/server.pid"
NGROK_PID="$RUN/ngrok.pid"
SERVER_LOG="$RUN/server.log"
NGROK_LOG="$RUN/ngrok.log"

green() { printf '\033[32m%s\033[0m\n' "$*"; }
red() { printf '\033[31m%s\033[0m\n' "$*" >&2; }

alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

# Dừng cả nhóm tiến trình (server.js tự chạy lại một tiến trình con để nạp chứng chỉ).
kill_group() {
  local pidfile=$1 name=$2
  if alive "$pidfile"; then
    local pid; pid=$(cat "$pidfile")
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    kill -KILL -- "-$pid" 2>/dev/null || true
    echo "Đã dừng $name (pid $pid)"
  fi
  rm -f "$pidfile"
}

public_url() {
  curl -s "http://$NGROK_API/api/tunnels" 2>/dev/null |
    python3 -c 'import json,sys; t=json.load(sys.stdin)["tunnels"]; print(t[0]["public_url"] if t else "")' 2>/dev/null || true
}

start_server() {
  if alive "$SERVER_PID"; then echo "Server đang chạy (pid $(cat "$SERVER_PID"))"; return; fi
  if ss -ltn 2>/dev/null | grep -q ":$PORT "; then
    red "Cổng $PORT đang bị chương trình khác dùng. Đổi PORT trong qlvb.conf hoặc tắt chương trình đó."
    exit 1
  fi
  [ -f "$SERVER_LOG" ] && mv -f "$SERVER_LOG" "$SERVER_LOG.1"
  PORT=$PORT setsid nohup node "$DIR/server.js" >"$SERVER_LOG" 2>&1 < /dev/null &
  echo $! >"$SERVER_PID"
  for _ in $(seq 1 20); do
    curl -s -o /dev/null "http://127.0.0.1:$PORT/" && { green "Server chạy tại http://localhost:$PORT"; return; }
    sleep 0.25
  done
  red "Server không khởi động được, xem log:"; tail -n 20 "$SERVER_LOG" >&2; exit 1
}

start_ngrok() {
  [ "$PUBLIC" = "ngrok" ] || return 0
  if ! command -v ngrok >/dev/null; then red "Chưa cài ngrok – bỏ qua bước public."; return 0; fi
  if alive "$NGROK_PID"; then echo "ngrok đang chạy: $(public_url)"; return; fi
  [ -f "$NGROK_LOG" ] && mv -f "$NGROK_LOG" "$NGROK_LOG.1"
  # Cổng API cục bộ riêng để không đụng ngrok khác; ghép thêm vào cấu hình mặc định (giữ authtoken).
  printf 'version: "3"\nagent:\n  web_addr: %s\n' "$NGROK_API" >"$RUN/ngrok-extra.yml"
  local base; base=$(ngrok config check 2>/dev/null | grep -oE '/[^ ]+\.yml' || true)
  local args=(http "$PORT" --log=stdout)
  [ -n "$base" ] && args+=(--config="$base")
  args+=(--config="$RUN/ngrok-extra.yml")
  [ -n "$NGROK_URL" ] && args+=(--url="$NGROK_URL")
  setsid nohup ngrok "${args[@]}" >"$NGROK_LOG" 2>&1 < /dev/null &
  echo $! >"$NGROK_PID"
  local url=""
  for _ in $(seq 1 40); do
    url=$(public_url); [ -n "$url" ] && break
    alive "$NGROK_PID" || break
    sleep 0.25
  done
  if [ -n "$url" ]; then
    green "Public tại $url"
    echo "$url" >"$RUN/public_url"
  else
    red "ngrok không mở được tunnel, xem log:"; grep -iE 'err|fail' "$NGROK_LOG" | tail -n 5 >&2 || tail -n 10 "$NGROK_LOG" >&2
    kill_group "$NGROK_PID" ngrok >/dev/null
  fi
}

status() {
  if alive "$SERVER_PID"; then green "● Server: đang chạy (pid $(cat "$SERVER_PID")) – http://localhost:$PORT"
  else echo "○ Server: đã dừng"; fi
  if [ "$PUBLIC" = "ngrok" ]; then
    if alive "$NGROK_PID"; then green "● ngrok : đang chạy – $(public_url)"
    else echo "○ ngrok : đã dừng"; fi
  fi
}

case "${1:-}" in
  start) start_server; start_ngrok ;;
  stop) kill_group "$NGROK_PID" ngrok; kill_group "$SERVER_PID" server; echo "Đã dừng QLVB Mobile." ;;
  restart) "$0" stop; "$0" start ;;
  status) status ;;
  logs) tail -n 50 -f "$SERVER_LOG" ;;
  url) public_url ;;
  *) echo "Cách dùng: $0 {start|stop|restart|status|logs|url}"; exit 1 ;;
esac
