#!/bin/bash
# 在服务器上执行。镜像已经导入，清单在 /opt/ai-langchain/k8s。
# 先把客服网页改成 ClusterIP，再启用 Traefik，避免两个入口抢 80 端口。
set -euo pipefail
export PATH="/usr/local/bin:$PATH"
: "${API_IMAGE:?}"
: "${WEB_IMAGE:?}"

sed "s#ghcr.io/charlenelbb/ai-langchain-api:bootstrap#${API_IMAGE}#" \
  /opt/ai-langchain/k8s/api.yaml | kubectl apply -f -
sed "s#ghcr.io/charlenelbb/ai-langchain-web:bootstrap#${WEB_IMAGE}#" \
  /opt/ai-langchain/k8s/web.yaml | kubectl apply -f -
kubectl -n ai-langchain rollout status deployment/api --timeout=180s
kubectl -n ai-langchain rollout status deployment/web --timeout=180s

bash /opt/ai-langchain/k8s/enable-traefik.sh

applied=0
for _ in $(seq 1 30); do
  if kubectl apply -f /opt/ai-langchain/k8s/ingress.yaml; then
    applied=1
    break
  fi
  sleep 3
done
if [[ "$applied" != 1 ]]; then
  echo "客服 Ingress 没有应用成功" >&2
  exit 1
fi

if [[ -f /opt/portal/apply.sh ]]; then
  bash /opt/portal/apply.sh
fi

kubectl -n ai-langchain rollout status deployment/api --timeout=180s
kubectl -n ai-langchain rollout status deployment/web --timeout=180s
