# 构建上下文是仓库根目录：
# docker build --platform linux/amd64 -f servers/my-llm-server/Dockerfile -t ai-langchain-api .
FROM node:22-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@12.4.2

WORKDIR /repo
ENV CI=true
COPY . .
RUN pnpm install --frozen-lockfile --filter my-llm-server...
WORKDIR /repo/servers/my-llm-server
RUN pnpm exec prisma generate && pnpm run build
WORKDIR /repo
RUN pnpm --filter my-llm-server deploy --prod /prod \
  && rm -rf /prod/dist /prod/prisma \
  && cp -a servers/my-llm-server/dist /prod/dist \
  && cp -a servers/my-llm-server/prisma /prod/prisma

FROM node:22-bookworm-slim AS runner

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g prisma@5.22.0 \
  && rm -rf /root/.npm

WORKDIR /app
# 只带走运行所需文件，避免把源码、测试和 .env 打进镜像。
COPY --from=build /prod/package.json /app/package.json
COPY --from=build /prod/node_modules /app/node_modules
COPY --from=build /prod/dist /app/dist
COPY --from=build /prod/prisma /app/prisma
RUN prisma generate \
  && chown -R node:node /app
COPY servers/my-llm-server/docker-entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh

ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["/entrypoint.sh"]
