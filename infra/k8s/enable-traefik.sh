#!/bin/bash
# 在服务器上执行。调用前客服 Web Service 必须已经是 ClusterIP。
# Traefik 已在运行时直接退出，不重启 k3s。
set -euo pipefail
export PATH="/usr/local/bin:$PATH"

wait_for_traefik() {
  for _ in $(seq 1 60); do
    if kubectl -n kube-system get deploy traefik >/dev/null 2>&1; then
      kubectl -n kube-system rollout status deploy/traefik --timeout=180s
      echo "Traefik 已就绪"
      return 0
    fi
    sleep 3
  done
  echo "Traefik 没有启动" >&2
  return 1
}

if kubectl -n kube-system get deploy traefik >/dev/null 2>&1; then
  echo "Traefik 已启用"
  exit 0
fi

if kubectl -n ai-langchain get svc web -o jsonpath='{.spec.type}' 2>/dev/null | grep -qx LoadBalancer; then
  echo "web service 仍是 LoadBalancer，不能启动 Traefik" >&2
  exit 1
fi

for _ in $(seq 1 30); do
  kubectl -n kube-system get svc svclb-web >/dev/null 2>&1 || break
  sleep 2
done
if kubectl -n kube-system get svc svclb-web >/dev/null 2>&1; then
  echo "80 端口仍被客服网页占用" >&2
  exit 1
fi

if ! grep -q 'disable=traefik' /etc/systemd/system/k3s.service; then
  wait_for_traefik
  exit 0
fi

python3 - <<'PY'
from pathlib import Path

path = Path("/etc/systemd/system/k3s.service")
lines = path.read_text().splitlines()
kept = []
index = 0
while index < len(lines):
    line = lines[index]
    body = line.strip().rstrip("\\").strip().strip("'\"")
    if body == "--disable=traefik":
        following = ""
        for later in lines[index + 1 :]:
            if later.strip():
                following = later
                break
        if kept and kept[-1].rstrip().endswith("\\") and not following:
            kept[-1] = kept[-1].rstrip()[:-1].rstrip()
        index += 1
        continue
    kept.append(line)
    index += 1
path.write_text("\n".join(kept) + "\n")
PY

systemctl daemon-reload
systemctl restart k3s
wait_for_traefik
