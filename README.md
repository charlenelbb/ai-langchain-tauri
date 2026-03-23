# AI LangChain Tauri

一个基于 **Tauri + React + NestJS + LangChain/LangGraph + Prisma** 的 AI 助手平台。  
项目采用前后端分离与 Monorepo 结构，支持医疗问答、文生图、RAG 与工作流编排等能力，并可在桌面端运行。

## 主要功能

- **医疗问答（多轮上下文）**
  - 会话历史管理（新建、切换、重命名、删除）
  - 支持图片可选上传（无图纯文本也可分析）
  - 流式输出回答，支持“模型思考过程”展示
  - 对话消息支持 Markdown 渲染
![logo](./clients/my-ai-app/public/medical.png)

- **文生图**
  - 基于提示词生成图像
  - 历史记录管理与会话化使用体验
![logo](./clients/my-ai-app/public/pic.png)

- **RAG 知识库**
  - 文本向量检索与问答增强
  - 向量模型支持 DashScope `text-embedding-v4`
![logo](./clients/my-ai-app/public/rag.png)

## 项目亮点

- **端到端流式体验**：后端 SSE 推流，前端打字机式输出与思考过程可视化。
- **多模型接入能力**：文本/多模态/向量能力统一接入 DashScope，按场景自动路由模型与端点。
- **会话记忆与历史持久化**：基于 Prisma 管理 `Session`/`Message`，支持多轮上下文。
- **桌面应用形态**：通过 Tauri 将 Web 能力打包为轻量桌面端。

## 仓库结构

```text
.
├─ clients/
│  └─ my-ai-app/          # 前端应用（React + Vite + Tauri）
├─ servers/
│  └─ my-llm-server/      # 后端服务（NestJS + LangChain + Prisma）
├─ frontend/              # 其它前端实验/历史目录
├─ pnpm-workspace.yaml    # Monorepo 工作区
└─ README.md
```

## 快速开始

### 1) 安装依赖

```bash
pnpm install
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

在 `servers/my-llm-server` 下配置 `.env`（示例）：

```env
DATABASE_URL=postgresql://user:password@localhost:5432/ai_langchain

DASHSCOPE_API_KEY=your_api_key
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/api/v1

# 可选：请求超时（毫秒）
DASHSCOPE_STREAM_TIMEOUT_MS=180000
DASHSCOPE_NONSTREAM_TIMEOUT_MS=180000
```

## 说明

- 本项目中的 AI 输出仅供参考，尤其是医疗建议场景，请结合专业医生意见。
- 若用于生产环境，建议补充鉴权、限流、审计日志与更完善的异常监控。
