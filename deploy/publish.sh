#!/usr/bin/env bash
# Publish by syncing this checkout to the server and restarting the service.
#
# Usage:
#   SERVER=deploy@example.com ./deploy/publish.sh
#   REMOTE_SUDO= can be used when the SSH account is already privileged.
set -euo pipefail

: "${SERVER:?Set SERVER=user@host before running, e.g. SERVER=deploy@example.com ./deploy/publish.sh}"
TARGET="${TARGET:-/opt/schedule}"
PUBLIC_URL="${PUBLIC_URL:-https://schedule.cks06971.com}"
REMOTE_SUDO="${REMOTE_SUDO:-sudo}"

cd "$(dirname "$0")/.."

echo ">>> 同步代码到 $SERVER:$TARGET"
# 注意排除 data/ —— 服务器上的勾选状态、抓取结果、个人备注和自定义事件不能被本地覆盖。
rsync -az --delete \
  --exclude node_modules \
  --exclude data \
  --exclude .git \
  --exclude .DS_Store \
  --exclude .env \
  --exclude '.env.*' \
  --exclude scratch \
  --exclude tmp \
  -e ssh ./ "$SERVER:$TARGET/"

echo ">>> 安装依赖并重启"
ssh "$SERVER" "set -e; cd '$TARGET'; npm install --omit=dev --silent; mkdir -p data; $REMOTE_SUDO chown -R schedule:schedule data 2>/dev/null || true; if $REMOTE_SUDO systemctl cat schedule >/dev/null 2>&1; then $REMOTE_SUDO systemctl restart schedule; else echo 'schedule.service 尚未安装，跳过重启'; fi"

echo ">>> 等服务起来…"
sleep 3
ssh "$SERVER" "if $REMOTE_SUDO systemctl is-active --quiet schedule; then curl -sf http://127.0.0.1:8132/healthz && echo; else echo 'schedule.service 尚未运行，跳过健康检查'; fi"

echo ">>> 完成： $PUBLIC_URL"
