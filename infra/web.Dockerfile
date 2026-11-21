# 构建上下文是仓库根目录：
# docker build -f infra/web.Dockerfile -t ghcr.io/charlenelbb/ai-langchain-web .
FROM node:22-bookworm-slim AS build

RUN npm install -g pnpm@12.4.2

WORKDIR /repo
ENV CI=true
ENV VITE_BASE=/cs/
ENV VITE_API_BASE=http://charlenecloud.com/api/cs
COPY . .
RUN pnpm install --frozen-lockfile --filter my-ai-app...
RUN pnpm --filter my-ai-app build

FROM nginx:1.27-alpine

COPY infra/stack/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/clients/my-ai-app/dist /usr/share/nginx/html/cs
RUN chmod -R a+rX /usr/share/nginx/html

EXPOSE 80
