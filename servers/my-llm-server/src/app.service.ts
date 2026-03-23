import { Injectable } from '@nestjs/common';
import { invokePrompt, invokePromptStream } from './fundamentals/prompt';
import { invokeRAG } from './fundamentals/rag';
import { invokePGVector } from './fundamentals/pg-vector';
import { analyzeMedicalImage, analyzeMedicalTextStream } from './fundamentals/medical';

import { writeFile, mkdir, readFile, readdir, stat, unlink } from 'fs/promises';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { MemoryService } from './memory.service';
import { PrismaService } from './prisma.service';

@Injectable()
export class AppService {
  constructor(
    private memoryService: MemoryService,
    private prisma: PrismaService,
  ) {}
  async rag(query: string) {
    return await invokePGVector(query);
  }
  async prompt(msg: string): Promise<any> {
    const response = await invokePrompt(msg);
    return response;
  }
  async *promptStream(msg: string) {
    yield* invokePromptStream(msg);
  }
  async medicalAnalysis(fileBuffer: Buffer, question: string) {
    const base64 = fileBuffer.toString('base64');
    const result = await analyzeMedicalImage(base64, question);
    try {
      await (this.prisma.client as any).medicalRecord.create({
        data: { question: question || '', answer: result.content },
      });
    } catch {
      // 忽略入库失败
    }
    return result;
  }

  /** 流式医疗分析：先拉取完整结果（含思考），再按块 yield 思考与回答，便于前端展示推理过程 */
  async *medicalAnalysisStream(
    fileBuffer: Buffer,
    question: string,
  ): AsyncGenerator<{ type: 'thinking' | 'chunk'; chunk: string }, void, unknown> {
    const base64 = fileBuffer.toString('base64');

    // 无图：用 DashScope streaming 逐 token 推送，避免纯文本等待完整结果导致超时
    if (!base64.trim()) {
      yield* analyzeMedicalTextStream(question);
      return;
    }

    // 有图：仍走完整结果后分块 yield（多模态 streaming 先不做）
    const { reasoning, content } = await analyzeMedicalImage(base64, question);
    const chunkSize = 40;
    if (reasoning?.length) {
      for (let i = 0; i < reasoning.length; i += chunkSize) {
        yield { type: 'thinking', chunk: reasoning.slice(i, i + chunkSize) };
      }
    }
    for (let i = 0; i < content.length; i += chunkSize) {
      yield { type: 'chunk', chunk: content.slice(i, i + chunkSize) };
    }
  }

  async saveMedicalRecord(question: string, answer: string) {
    try {
      await (this.prisma.client as any).medicalRecord.create({
        data: { question: question || '', answer },
      });
    } catch {
      // ignore
    }
  }

  async listMedicalHistory(limit = 50) {
    try {
      const list = await (this.prisma.client as any).medicalRecord.findMany({
        orderBy: { createdAt: 'desc' },
        take: Math.min(Number(limit) || 50, 100),
      });
      return list.map((row) => ({
        id: row.id,
        question: row.question,
        answer: row.answer,
        createdAt: row.createdAt.toISOString(),
      }));
    } catch {
      return [];
    }
  }

  getHello(): string {
    return 'Hello World!';
  }

  // -------------------- Session Management with LangChain Memory --------------------

  async listSessions(): Promise<any[]> {
    return await this.memoryService.listSessions();
  }

  async createSession(title?: string): Promise<any> {
    const sessionId = await this.memoryService.createSession(
      title || `会话 ${Date.now()}`,
    );
    return await this.memoryService.getSession(sessionId);
  }

  async getSession(id: string): Promise<any | null> {
    return await this.memoryService.getSession(id);
  }

  async appendMessage(sessionId: string, message: any): Promise<any> {
    if (message.sender === 'user') {
      await this.memoryService.addUserMessage(sessionId, message.text);
    } else if (message.sender === 'assistant') {
      await this.memoryService.addAssistantMessage(sessionId, message.text);
    }
    return await this.memoryService.getSession(sessionId);
  }

  async deleteSession(id: string): Promise<boolean> {
    await this.memoryService.deleteSession(id);
    return true;
  }

  async updateSessionTitle(id: string, title: string): Promise<any | null> {
    await this.memoryService.updateSessionTitle(id, title);
    return await this.memoryService.getSession(id);
  }

  async getSessionHistory(sessionId: string): Promise<any[]> {
    return await this.memoryService.getMessages(sessionId);
  }

  async getSessionContext(sessionId: string): Promise<string> {
    return await this.memoryService.getMemoryContext(sessionId);
  }

  // 获取 LangChain BufferMemory 对象，用于高级记忆操作
  async getSessionMemory(sessionId: string) {
    return await this.memoryService.getMemory(sessionId);
  }

  // 清除会话记忆
  async clearSessionMemory(sessionId: string): Promise<void> {
    await this.memoryService.clearMemory(sessionId);
  }
}
