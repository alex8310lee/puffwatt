#!/usr/bin/env bash
# PUFFWATT 원클릭 실행 (macOS / Linux)
cd "$(dirname "$0")"
if ! command -v node >/dev/null || [ "$(node -e 'process.stdout.write(String(+process.versions.node.split(".")[0]>=22 && (+process.versions.node.split(".")[1]>=5 || +process.versions.node.split(".")[0]>22)))')" != "true" ]; then
  echo "Node.js 22.5 이상이 필요합니다 → https://nodejs.org"; read -p "엔터를 누르면 종료"; exit 1; fi
PORT="${PORT:-3000}" PUFFWATT_ENV=development node server/index.js &
PID=$!; sleep 1.5
URL="http://localhost:${PORT:-3000}"
echo "PUFFWATT 실행 중 → $URL  (종료: Ctrl+C)"
(command -v open >/dev/null && open "$URL") || (command -v xdg-open >/dev/null && xdg-open "$URL") || true
wait $PID
