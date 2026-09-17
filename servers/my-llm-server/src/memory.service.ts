import { Injectable } from '@nestjs/common';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { BufferMemory, ChatMessageHistory } from '@langchain/classic/memory';
import { PrismaService } from './prisma.service';
import { randomUUID } from 'crypto';
import { previewLastMessage } from './cs/cs-view';

export const SESSION_KIND_CS = 'customer-service';

function parseMetadata(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function encodeMetadata(
  metadata?: Record<string, unknown> | null,
): string | undefined {
  if (!metadata) return undefined;
  return JSON.stringify(metadata);
}

@Injectable()
export class MemoryService {
  // LangChain BufferMemory 缓存
  private memoryCache = new Map<string, BufferMemory>();

  constructor(private prisma: PrismaService) {}

  /**
   * 获取或创建会话的记忆对象
   */
  async getMemory(sessionId: string): Promise<BufferMemory> {
    if (this.memoryCache.has(sessionId)) {
      return this.memoryCache.get(sessionId)!;
    }

    // 从数据库加载历史消息
    const messages = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });

    // 创建 ChatMessageHistory
    const chatHistory = new ChatMessageHistory();

    // 将数据库消息转换为 LangChain 消息格式
    for (const msg of messages) {
      if (msg.role === 'user') {
        await chatHistory.addMessage(new HumanMessage(msg.content));
      } else if (msg.role === 'assistant') {
        await chatHistory.addMessage(new AIMessage(msg.content));
      }
    }

    // 创建 BufferMemory
    const memory = new BufferMemory({
      chatHistory,
      returnMessages: true,
    });

    // 缓存记忆对象
    this.memoryCache.set(sessionId, memory);

    return memory;
  }

  /**
   * 添加用户消息到记忆
   */
  async addUserMessage(
    sessionId: string,
    content: string,
    metadata?: Record<string, unknown> | null,
  ): Promise<void> {
    // 验证 session 存在
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new Error(`Session with id ${sessionId} not found`);
    }

    const memory = await this.getMemory(sessionId);

    // 添加到 LangChain 记忆
    await memory.chatHistory.addMessage(new HumanMessage(content));

    // 保存到数据库
    await this.prisma.message.create({
      data: {
        sessionId,
        role: 'user',
        content,
        metadata: encodeMetadata(metadata),
      },
    });
  }

  /**
   * 添加助手消息到记忆
   */
  async addAssistantMessage(
    sessionId: string,
    content: string,
    metadata?: Record<string, unknown> | null,
  ): Promise<void> {
    // 验证 session 存在
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new Error(`Session with id ${sessionId} not found`);
    }

    const memory = await this.getMemory(sessionId);

    // 添加到 LangChain 记忆
    await memory.chatHistory.addMessage(new AIMessage(content));

    // 保存到数据库
    await this.prisma.message.create({
      data: {
        sessionId,
        role: 'assistant',
        content,
        metadata: encodeMetadata(metadata),
      },
    });
  }

  /**
   * 滑动窗口 + 旧消息摘要，避免把整段历史塞进 prompt。
   */
  async getMemoryContext(sessionId: string, windowSize = 8): Promise<string> {
    const messages = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
    if (!messages.length) return '';

    const label = (role: string) =>
      role === 'user' ? '用户' : role === 'agent' ? '坐席' : '客服';

    const format = (m: { role: string; content: string }) =>
      `${label(m.role)}：${m.content}`.slice(0, 400);

    if (messages.length <= windowSize) {
      return messages.map(format).join('\n');
    }

    const older = messages.slice(0, -windowSize);
    const recent = messages.slice(-windowSize);
    const summary = older
      .slice(-12)
      .map((m) => `${label(m.role)}：${m.content.slice(0, 40)}`)
      .join('；');
    return `更早对话摘要：${summary}\n\n${recent.map(format).join('\n')}`;
  }

  /**
   * 清除会话记忆
   */
  async clearMemory(sessionId: string): Promise<void> {
    // 从缓存中移除
    this.memoryCache.delete(sessionId);

    // 从数据库中删除所有消息
    await this.prisma.message.deleteMany({
      where: { sessionId },
    });
  }

  /**
   * 获取会话的所有消息
   */
  async getMessages(sessionId: string): Promise<any[]> {
    const messages = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });

    return messages.map((msg) => ({
      id: msg.id,
      sender: msg.role,
      text: msg.content,
      timestamp: msg.createdAt.getTime(),
      metadata: parseMetadata(msg.metadata),
    }));
  }

  /**
   * 创建新会话
   */
  async createSession(
    title: string,
    kind: string = SESSION_KIND_CS,
    userId?: string,
  ): Promise<string> {
    const session = await this.prisma.session.create({
      data: {
        id: randomUUID(),
        title,
        kind: kind || SESSION_KIND_CS,
        userId: userId || null,
      },
    });
    return session.id;
  }

  /**
   * 获取会话信息
   */
  async getSession(sessionId: string): Promise<any | null> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!session) return null;

    return {
      id: session.id,
      title: session.title,
      kind: session.kind,
      intent: session.intent,
      userId: session.userId,
      botPaused: session.botPaused,
      handoffAt: session.handoffAt?.toISOString() || null,
      messages: session.messages.map((msg) => ({
        id: msg.id,
        sender: msg.role,
        text: msg.content,
        timestamp: msg.createdAt.getTime(),
        metadata: parseMetadata(msg.metadata),
      })),
      createdAt: session.createdAt.getTime(),
      updatedAt: session.updatedAt.getTime(),
    };
  }

  /**
   * 列出会话；kind 缺省时仅返回客服会话。
   */
  async listSessions(
    kind: string = SESSION_KIND_CS,
    opts?: { userId?: string },
  ): Promise<any[]> {
    const sessions = await this.prisma.session.findMany({
      where: {
        kind,
        ...(opts?.userId ? { userId: opts.userId } : {}),
      },
      include: {
        _count: {
          select: { messages: true },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, role: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return sessions.map((session) => {
      const last = session.messages[0];
      return {
        id: session.id,
        title: session.title,
        kind: session.kind,
        intent: session.intent,
        userId: session.userId,
        botPaused: session.botPaused,
        messageCount: session._count.messages,
        lastMessage: last ? previewLastMessage(last.content) : '',
        lastSender: last?.role || null,
        createdAt: session.createdAt.getTime(),
        updatedAt: session.updatedAt.getTime(),
      };
    });
  }

  /**
   * 添加坐席消息（转人工后同一时间线）
   */
  async addAgentMessage(
    sessionId: string,
    content: string,
    metadata?: Record<string, unknown> | null,
  ): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new Error(`Session with id ${sessionId} not found`);
    }
    this.memoryCache.delete(sessionId);
    await this.prisma.message.create({
      data: {
        sessionId,
        role: 'agent',
        content,
        metadata: encodeMetadata(metadata),
      },
    });
  }

  async setBotPaused(sessionId: string, paused: boolean): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        botPaused: paused,
        handoffAt: paused ? new Date() : null,
      },
    });
    this.memoryCache.delete(sessionId);
  }

  async updateSessionIntent(sessionId: string, intent: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { intent },
    });
  }

  /**
   * 更新会话标题
   */
  async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { title },
    });
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<void> {
    // 删除消息（级联删除）
    await this.prisma.message.deleteMany({
      where: { sessionId },
    });

    // 删除会话
    await this.prisma.session.delete({
      where: { id: sessionId },
    });

    // 从缓存中移除
    this.memoryCache.delete(sessionId);
  }
}
