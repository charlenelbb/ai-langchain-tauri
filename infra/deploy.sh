#!/bin/bash
# 在仓库根目录构建网页和 API 镜像，再发布到香港 ECS。
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

SECRETS="$ROOT/infra/.deploy-secrets"
KEY="$ROOT/infra/.ssh-key"
ENV_FILE="$ROOT/servers/my-llm-server/.env"

if [[ ! -f "$SECRETS" ]]; then
  if [[ -z "${DASHSCOPE_API_KEY:-}" && -f "$ENV_FILE" ]]; then
    DASHSCOPE_API_KEY="$(grep -E '^DASHSCOPE_API_KEY=' "$ENV_FILE" | head -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
  fi
  if [[ -z "${DASHSCOPE_API_KEY:-}" ]]; then
    echo "缺少 DASHSCOPE_API_KEY。请写在 servers/my-llm-server/.env，或在当前终端导出后再运行。" >&2
    exit 1
  fi
  umask 077
  cat > "$SECRETS" <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 16)
AUTH_SECRET=$(openssl rand -hex 32)
DASHSCOPE_API_KEY=${DASHSCOPE_API_KEY}
EOF
fi

set -a
# shellcheck disable=SC1090
source "$SECRETS"
set +a

umask 077
terraform -chdir="$ROOT/infra" output -raw private_key > "$KEY"
IP="$(terraform -chdir="$ROOT/infra" output -raw public_ip)"

echo "等待 SSH 与 Docker：$IP"
ready=0
for _ in $(seq 1 36); do
  if ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 "root@$IP" 'docker info >/dev/null 2>&1'; then
    ready=1
    break
  fi
  sleep 5
done
if [[ "$ready" != 1 ]]; then
  echo "服务器还没装好 Docker。过几分钟再运行 infra/deploy.sh。" >&2
  exit 1
fi

echo "构建网页"
VITE_API_BASE="http://$IP" pnpm --filter my-ai-app build

echo "上传源码并在服务器上构建 API 镜像"
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "root@$IP" 'mkdir -p /opt/ai-langchain/src /opt/ai-langchain/web'
rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude dist \
  --exclude coverage \
  --exclude .env \
  --exclude infra/.terraform \
  --exclude infra/.ssh-key \
  --exclude infra/.deploy-secrets \
  --exclude infra/*.tfstate \
  --exclude postgresql_data \
  --exclude src-tauri/target \
  -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
  "$ROOT/" "root@$IP:/opt/ai-langchain/src/"
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "root@$IP" \
  'cd /opt/ai-langchain/src && docker build -f servers/my-llm-server/Dockerfile -t ai-langchain-api:latest .'

echo "上传网页并启动"
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "root@$IP" 'mkdir -p /opt/ai-langchain/web'
scp -i "$KEY" -o StrictHostKeyChecking=accept-new \
  "$ROOT/infra/stack/docker-compose.yml" \
  "$ROOT/infra/stack/nginx.conf" \
  "$ROOT/infra/stack/proxy_params.conf" \
  "root@$IP:/opt/ai-langchain/"
scp -i "$KEY" -o StrictHostKeyChecking=accept-new -r \
  "$ROOT/clients/my-ai-app/dist/." \
  "root@$IP:/opt/ai-langchain/web/"
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "root@$IP" 'chmod -R a+rX /opt/ai-langchain/web'
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "root@$IP" 'umask 077; cat > /opt/ai-langchain/.env' <<EOF
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
AUTH_SECRET=${AUTH_SECRET}
DASHSCOPE_API_KEY=${DASHSCOPE_API_KEY}
CORS_ORIGIN=http://${IP}
EOF
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "root@$IP" 'cd /opt/ai-langchain && docker compose up -d'

echo "已发布：http://$IP"
