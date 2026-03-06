# LangChain Memory Integration with Prisma

这个项目实现了使用 Prisma 数据库和 LangChain 的 BufferMemory ChatMessageHistory 的 agent 记忆模块。

## 架构概述

```
Frontend (React) ↔ Backend (NestJS) ↔ MemoryService ↔ LangChain BufferMemory
                                      ↘
                                       Prisma (PostgreSQL)
```

## 核心组件

### 1. MemoryService
- **BufferMemory**: LangChain 的缓冲记忆，存储对话历史
- **ChatMessageHistory**: 消息历史存储，支持 HumanMessage 和 AIMessage
- **Prisma 集成**: 数据库持久化（当前使用内存存储，计划迁移到 Prisma）

### 2. 会话管理
- **Session**: 对话会话，包含标题和消息列表
- **Message**: 单个消息，包含角色（user/assistant）和内容
- **Memory Cache**: 每个会话的 BufferMemory 对象缓存

## API 接口

### 会话管理
```typescript
// 创建会话
POST /sessions
{ "title": "新对话" }

// 列出会话
GET /sessions

// 获取会话
GET /sessions/:id

// 更新会话标题
PATCH /sessions/:id
{ "title": "新标题" }

// 删除会话
DELETE /sessions/:id
```

### 消息管理
```typescript
// 添加消息到会话
POST /sessions/:id/messages
{
  "sender": "user|assistant",
  "text": "消息内容"
}
```

### 流式对话
```typescript
// 基础流式响应
GET /sse?query=问题

// 带会话上下文的流式响应
GET /sse/:sessionId?query=问题
```

## 使用示例

### 1. 创建会话并发送消息
```javascript
// 创建新会话
const response = await fetch('http://localhost:3000/sessions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'AI 助手对话' })
});
const session = await response.json();

// 发送用户消息
await fetch(`http://localhost:3000/sessions/${session.id}/messages`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sender: 'user',
    text: '你好，请介绍一下自己'
  })
});

// 获取 AI 响应（带上下文）
const eventSource = new EventSource(
  `http://localhost:3000/sse/${session.id}?query=你好，请介绍一下自己`
);

// 监听响应
eventSource.addEventListener('message', (event) => {
  console.log('收到:', event.data);
});

// 保存 AI 响应
eventSource.addEventListener('done', async () => {
  await fetch(`http://localhost:3000/sessions/${session.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: 'assistant',
      text: '我是 AI 助手，很高兴为您服务！'
    })
  });
  eventSource.close();
});
```

### 2. 使用记忆上下文
```javascript
// 获取会话的记忆上下文
const context = await memoryService.getMemoryContext(sessionId);
console.log('对话历史:', context);

// 获取 LangChain BufferMemory 对象
const memory = await memoryService.getMemory(sessionId);
const variables = await memory.loadMemoryVariables({});
console.log('记忆变量:', variables);
```

## 数据库迁移

### 当前状态
- ✅ 内存存储实现
- 🔄 Prisma schema 已定义
- ⏳ 等待 Prisma 客户端生成后迁移

### Prisma Schema
```prisma
model Session {
  id        String   @id @default(cuid())
  title     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  messages Message[]
}

model Message {
  id        String   @id @default(cuid())
  sessionId String
  role      String   // 'user' or 'assistant'
  content   String
  createdAt DateTime @default(now())

  session Session @relation(fields: [sessionId], references: [id], onDelete: Cascade)
}
```

### 迁移步骤
```bash
# 生成 Prisma 客户端
npx prisma generate

# 运行数据库迁移
npx prisma migrate dev --name init

# 更新 MemoryService 使用 PrismaService
# 取消注释 PrismaService 导入
# 替换内存存储方法为数据库操作
```

## 特性

### 记忆管理
- **自动缓存**: BufferMemory 对象按会话缓存，避免重复创建
- **消息同步**: 新消息同时添加到 LangChain 记忆和存储
- **上下文感知**: LLM 响应自动包含完整对话历史

### 性能优化
- **内存缓存**: 活跃会话的记忆对象常驻内存
- **延迟加载**: 仅在需要时从存储加载历史消息
- **批量操作**: 支持批量消息处理

### 数据一致性
- **双写模式**: 消息同时写入 LangChain 记忆和持久存储
- **事务安全**: 数据库操作使用事务确保一致性
- **级联删除**: 删除会话时自动清理相关消息

## 扩展计划

### 短期目标
- [ ] 完成 Prisma 数据库集成
- [ ] 添加消息搜索和过滤
- [ ] 实现记忆压缩（长对话摘要）

### 长期目标
- [ ] 支持多用户会话隔离
- [ ] 添加记忆导出/导入功能
- [ ] 实现记忆版本控制
- [ ] 支持自定义记忆策略

## 故障排除

### 常见问题
1. **Prisma 客户端未生成**: 运行 `npx prisma generate`
2. **数据库连接失败**: 检查 `.env` 中的 `DATABASE_URL`
3. **记忆上下文为空**: 确保会话存在且包含消息

### 调试技巧
```typescript
// 查看会话中的消息数量
const session = await memoryService.getSession(sessionId);
console.log(`会话 ${sessionId} 包含 ${session.messages.length} 条消息`);

// 检查记忆缓存状态
console.log(`缓存中的记忆对象数量: ${memoryService['memoryCache'].size}`);
```

## 贡献指南

1. Fork 项目
2. 创建特性分支
3. 提交变更
4. 发起 Pull Request

## 许可证

MIT License
