# 智能客服

基于 **Tauri + React + NestJS + LangChain + Prisma** 的桌面端智能客服系统。  
前后端分离，Monorepo 结构：客服对话（RAG 检索增强 + 意图分类 + 工单）与知识库管理。

## 主要功能

- **智能客服**
  - 多轮会话（新建、切换、重命名、删除）
  - 基于知识库 `kbId=customer-service` 的检索后生成，回答带来源引用
  - 意图分类：售前 / 售后 / 投诉 / 其他
  - 知识库未命中或投诉时，可一键创建本地工单（待处理 → 处理中 → 已结案）
  - 登录鉴权：客户只看自己的会话/工单，坐席可认领工单并在同一时间线回复；转人工后机器人暂停
  - 可恢复 SSE 流式输出；常见 FAQ 改写成短答，其余用 qwen-flash 无思考流式
  - 示例 FAQ：`servers/my-llm-server/fixtures/customer-service-faq.md`

- **知识库**
  - 文本与 Word（`.docx`）入库：切分 + 向量化 + 写入 pgvector
  - 向量检索测试
  - Embedding 使用 DashScope `text-embedding-v4`
  - 入库按 `##` / `###` 标题切块，过长段再按约 400 字切分；切分规则变更后需重新上传文档覆盖旧块
![logo](./clients/my-ai-app/public/rag.png)

## 项目亮点

- **检索增强问答**：只根据知识库摘录作答，避免编造价格与政策。
- **可恢复流式体验**：后端按 `streamId` 缓冲 SSE，断线后续传。
- **会话与工单持久化**：Prisma + PostgreSQL 管理 `Session` / `Message` / `Ticket`。
- **桌面应用形态**：Tauri 将 Web 能力打包为轻量桌面端。

## 仓库结构

```text
.
├─ clients/
│  └─ my-ai-app/          # 前端应用（React + Vite + Tauri）
├─ servers/
│  └─ my-llm-server/      # 后端服务（NestJS + LangChain + Prisma）
├─ pnpm-workspace.yaml
└─ README.md
```

## 快速开始

### 1) 安装依赖

```bash
pnpm install
```

单元测试（鉴权 / 限流 / 客服策略，不打外部 API）：

```bash
pnpm --filter my-llm-server test:unit
```

### 2) 启动后端

```bash
pnpm --filter my-llm-server start:dev
```

### 3) 启动前端（Web）

```bash
pnpm --filter my-ai-app dev
```

### 4) 启动桌面端（Tauri）

```bash
pnpm --filter my-ai-app tauri dev
```

## 环境变量（后端）

在 `servers/my-llm-server` 下配置 `.env`（可复制 `.env.example`）。`DASHSCOPE_API_KEY` 必须是百炼控制台复制的 **`sk-` 开头**密钥，改完后需重启后端。

```env
DATABASE_URL=postgresql://postgres:password@localhost:5435/ai_langchain_db

DASHSCOPE_API_KEY=sk-your-dashscope-api-key
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/api/v1

# 可选：请求超时（毫秒）
DASHSCOPE_STREAM_TIMEOUT_MS=180000
DASHSCOPE_NONSTREAM_TIMEOUT_MS=180000

# 登录签名密钥（生产必须改成随机长串）
AUTH_SECRET=dev-only-change-me

# 可选：客服 RAG 命中阈值（pgvector cosine 距离，越小越相近）
CS_MAX_COSINE_DISTANCE=0.55

# 可选：客服作答模型（默认 qwen-flash；需要更稳表达可改为 qwen3-max）
# CS_TEXT_MODEL=qwen-flash
```

## 演示步骤

1. 启动 Postgres（含 pgvector）与后端、前端。
2. 在 `servers/my-llm-server` 执行 `npx prisma migrate deploy`（或 `migrate dev`）。
3. 打开应用先登录。演示账号：客户 `customer / demo123`，坐席 `agent / demo123`（知识库入库仅坐席）。
4. 坐席打开「知识库」，确认 kbId 为 `customer-service`，上传 FAQ 并入库。切分规则变更后请再传一次覆盖旧块。
5. 客户打开「智能客服」，提问例如「7 天无理由怎么退货？」「多久发货」。未命中或投诉可一键建单（建单后机器人暂停）。
6. 坐席在工单中点「认领并转人工」，在同一会话里用「坐席回复」对客，机器人不会再抢答。

## 说明

- 客服回答仅供参考，以知识库与人工工单为准。
- 演示含登录、会话归属、提问限流与审计日志；生产请更换 `AUTH_SECRET`，并视流量把 SSE 缓冲迁出单机内存。
