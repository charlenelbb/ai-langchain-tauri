#!/bin/bash
# 把已经推到 GHCR 的镜像发布到现有 k3s，并带上客服 Ingress。
# 本机存在首页项目时，一并把它传到服务器。不会启动 Docker Compose。
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
HOME_DIR="/Users/charlene/charlenecloud-home"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new)

echo "发布 ${TAG}"
docker pull "$API_IMAGE"
docker pull "$WEB_IMAGE"
docker save "$API_IMAGE" "$WEB_IMAGE" \
  | "${SSH[@]}" "root@$IP" 'k3s ctr images import -'
"${SSH[@]}" "root@$IP" \
  "k3s ctr images ls | grep -F '${API_IMAGE}' && k3s ctr images ls | grep -F '${WEB_IMAGE}'"

"${SSH[@]}" "root@$IP" 'mkdir -p /opt/ai-langchain/k8s'
rsync -az \
  -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
  "$ROOT/infra/k8s/" "root@$IP:/opt/ai-langchain/k8s/"
if [[ -f "$HOME_DIR/apply.sh" ]]; then
  "${SSH[@]}" "root@$IP" 'mkdir -p /opt/portal'
  rsync -az \
    -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
    "$HOME_DIR/" "root@$IP:/opt/portal/"
fi

"${SSH[@]}" "root@$IP" "API_IMAGE=${API_IMAGE} WEB_IMAGE=${WEB_IMAGE} bash -s" <<'EOF'
set -eu
export PATH="/usr/local/bin:$PATH"
bash /opt/ai-langchain/k8s/rollout.sh
EOF

echo "已发布：http://charlenecloud.com/cs/ (${TAG})"
