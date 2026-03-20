import { Injectable } from '@nestjs/common';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { BufferMemory, ChatMessageHistory } from '@langchain/classic/memory';
import { PrismaService } from './prisma.service';
import { randomUUID } from 'crypto';

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
  async addUserMessage(sessionId: string, content: string): Promise<void> {
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
      },
    });
  }

  /**
   * 添加助手消息到记忆
   */
  async addAssistantMessage(sessionId: string, content: string): Promise<void> {
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
      },
    });
  }

  /**
   * 获取会话的记忆上下文
   */
  async getMemoryContext(sessionId: string): Promise<string> {
    const memory = await this.getMemory(sessionId);
    const variables = await memory.loadMemoryVariables({});
    const history = (variables as any)?.history;

    if (typeof history === 'string') return history;

    // BufferMemory(returnMessages: true) 下 history 可能是消息数组
    if (Array.isArray(history)) {
      return history
        .map((m: any) => {
          if (!m) return '';
          if (typeof m.content === 'string') return m.content;
          if (typeof m.text === 'string') return m.text;
          if (typeof m === 'string') return m;
          return JSON.stringify(m);
        })
        .filter(Boolean)
        .join('\n');
    }

    return history ? String(history) : '';
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
    }));
  }

  /**
   * 创建新会话
   */
  async createSession(title: string): Promise<string> {
    const session = await this.prisma.session.create({
      data: {
        id: randomUUID(),
        title,
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
      messages: session.messages.map((msg) => ({
        id: msg.id,
        sender: msg.role,
        text: msg.content,
        timestamp: msg.createdAt.getTime(),
      })),
      createdAt: session.createdAt.getTime(),
      updatedAt: session.updatedAt.getTime(),
    };
  }

  /**
   * 列出所有会话
   */
  async listSessions(): Promise<any[]> {
    const sessions = await this.prisma.session.findMany({
      include: {
        _count: {
          select: { messages: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return sessions.map((session) => ({
      id: session.id,
      title: session.title,
      messageCount: session._count.messages,
      createdAt: session.createdAt.getTime(),
      updatedAt: session.updatedAt.getTime(),
    }));
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
