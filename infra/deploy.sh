#!/bin/bash
# 把已经推到 GHCR 的镜像发布到现有 k3s。不会启动 Docker Compose。
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
TAG="${IMAGE_TAG:-$(git rev-parse HEAD)}"
API_IMAGE="ghcr.io/charlenelbb/ai-langchain-api:${TAG}"
WEB_IMAGE="ghcr.io/charlenelbb/ai-langchain-web:${TAG}"

echo "发布 ${TAG}"
docker pull "$API_IMAGE"
docker pull "$WEB_IMAGE"
docker save "$API_IMAGE" "$WEB_IMAGE" \
  | ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "root@$IP" 'k3s ctr images import -'
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "root@$IP" \
  "k3s ctr images ls | grep -F '${API_IMAGE}' && k3s ctr images ls | grep -F '${WEB_IMAGE}'"
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "root@$IP" "bash -s" <<EOF
set -eu
export PATH="/usr/local/bin:\$PATH"
kubectl -n ai-langchain set image deployment/api api=${API_IMAGE}
kubectl -n ai-langchain set image deployment/web web=${WEB_IMAGE}
kubectl -n ai-langchain rollout status deployment/api --timeout=180s
kubectl -n ai-langchain rollout status deployment/web --timeout=180s
EOF

echo "已发布：http://charlenecloud.com (${TAG})"
