#!/usr/bin/env bash
# 로컬 원클릭 실행: ./start.sh
set -e
cd "$(dirname "$0")"
v=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ -z "$v" ] || [ "$v" -lt 22 ]; then echo "Node 22 이상이 필요합니다 → https://nodejs.org (현재: $(node -v 2>/dev/null || echo 없음))"; exit 1; fi
export PUFFWATT_ENV=${PUFFWATT_ENV:-development} PORT=${PORT:-3000}
echo "PUFFWATT → http://localhost:$PORT  (Ctrl+C 종료)"
( sleep 1.5; (open "http://localhost:$PORT" || xdg-open "http://localhost:$PORT" || start "http://localhost:$PORT") >/dev/null 2>&1 ) &
node server/index.js
