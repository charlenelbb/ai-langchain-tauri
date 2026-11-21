#!/bin/bash
# 在现有香港 ECS 上安装 k3s，迁入 Compose 里的数据库，并切到 Kubernetes。
# 会短暂停掉网站。原 Docker 卷保留。
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

KEY="$ROOT/infra/.ssh-key"
if [[ ! -f "$KEY" ]]; then
  umask 077
  terraform -chdir="$ROOT/infra" output -raw private_key > "$KEY"
  chmod 600 "$KEY"
fi
IP="$(terraform -chdir="$ROOT/infra" output -raw public_ip)"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new)

echo "上传清单和源码"
"${SSH[@]}" "root@$IP" 'mkdir -p /opt/ai-langchain/src /opt/ai-langchain/k8s'
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
  --exclude infra/*.tfstate.* \
  --exclude postgresql_data \
  --exclude src-tauri/target \
  -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
  "$ROOT/" "root@$IP:/opt/ai-langchain/src/"
rsync -az \
  -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
  "$ROOT/infra/k8s/" "root@$IP:/opt/ai-langchain/k8s/"

echo "安装 k3s 并构建镜像"
"${SSH[@]}" "root@$IP" 'bash -s' <<'EOF'
set -eu
export PATH="/usr/local/bin:$PATH"
if ! command -v k3s >/dev/null 2>&1; then
  curl -sfL https://get.k3s.io | sh -s -
fi
kubectl get nodes

cd /opt/ai-langchain/src
docker build -f servers/my-llm-server/Dockerfile -t ghcr.io/charlenelbb/ai-langchain-api:bootstrap .
docker build -f infra/web.Dockerfile -t ghcr.io/charlenelbb/ai-langchain-web:bootstrap .
docker save ghcr.io/charlenelbb/ai-langchain-api:bootstrap ghcr.io/charlenelbb/ai-langchain-web:bootstrap | k3s ctr images import -

kubectl apply -f /opt/ai-langchain/k8s/namespace.yaml
python3 - <<'PY'
import subprocess
import sys
from pathlib import Path

env = {}
for line in Path("/opt/ai-langchain/.env").read_text().splitlines():
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    env[key] = value
required = ["POSTGRES_PASSWORD", "AUTH_SECRET", "DASHSCOPE_API_KEY", "CORS_ORIGIN"]
missing = [key for key in required if not env.get(key)]
if missing:
    sys.stderr.write("missing env keys\n")
    sys.exit(1)
password = env["POSTGRES_PASSWORD"]
database_url = (
    f"postgresql://ailangchain:{password}@db:5432/ai_langchain_db?sslmode=disable"
)
manifest = subprocess.run(
    [
        "kubectl", "-n", "ai-langchain", "create", "secret", "generic", "ai-langchain-env",
        f"--from-literal=POSTGRES_PASSWORD={password}",
        f"--from-literal=DATABASE_URL={database_url}",
        f"--from-literal=AUTH_SECRET={env['AUTH_SECRET']}",
        f"--from-literal=DASHSCOPE_API_KEY={env['DASHSCOPE_API_KEY']}",
        f"--from-literal=CORS_ORIGIN={env['CORS_ORIGIN']}",
        "--dry-run=client", "-o", "yaml",
    ],
    check=True,
    capture_output=True,
    text=True,
).stdout
applied = subprocess.run(
    ["kubectl", "apply", "-f", "-"],
    input=manifest,
    text=True,
    capture_output=True,
)
if applied.returncode != 0:
    sys.stderr.write("secret apply failed\n")
    sys.exit(applied.returncode)
print(applied.stdout.strip())
PY

kubectl apply -f /opt/ai-langchain/k8s/postgres.yaml
kubectl -n ai-langchain rollout status statefulset/db --timeout=180s

if docker ps --format '{{.Names}}' | grep -qx 'ai-langchain-db-1'; then
  umask 077
  docker exec ai-langchain-db-1 pg_dump -U ailangchain -d ai_langchain_db --no-owner --no-acl --clean --if-exists > /opt/ai-langchain/db.dump
  kubectl -n ai-langchain cp /opt/ai-langchain/db.dump db-0:/tmp/db.dump
  kubectl -n ai-langchain exec db-0 -- psql -U ailangchain -d ai_langchain_db -v ON_ERROR_STOP=1 -f /tmp/db.dump
  kubectl -n ai-langchain exec db-0 -- rm -f /tmp/db.dump
  rm -f /opt/ai-langchain/db.dump
fi

kubectl apply -f /opt/ai-langchain/k8s/api.yaml
kubectl -n ai-langchain rollout status deployment/api --timeout=180s

docker compose -f /opt/ai-langchain/docker-compose.yml stop web || true
kubectl apply -f /opt/ai-langchain/k8s/web.yaml
kubectl -n ai-langchain rollout status deployment/web --timeout=180s
bash /opt/ai-langchain/k8s/enable-traefik.sh
kubectl apply -f /opt/ai-langchain/k8s/ingress.yaml
EOF

echo "k3s 已启动。确认网站可用后，再停掉旧的 API 和数据库容器。"
