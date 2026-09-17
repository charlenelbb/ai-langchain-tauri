import { Injectable } from '@nestjs/common';
import { MemoryService } from './memory.service';

@Injectable()
export class AppService {
  constructor(private memoryService: MemoryService) {}

  getHello(): string {
    return 'Hello World!';
  }

  async listSessions(kind?: string, userId?: string): Promise<any[]> {
    return await this.memoryService.listSessions(kind, userId ? { userId } : undefined);
  }

  async createSession(title?: string, kind?: string, userId?: string): Promise<any> {
    const sessionId = await this.memoryService.createSession(
      title || `会话 ${Date.now()}`,
      kind,
      userId,
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
    } else if (message.sender === 'agent') {
      await this.memoryService.addAgentMessage(sessionId, message.text);
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

  async getSessionMemory(sessionId: string) {
    return await this.memoryService.getMemory(sessionId);
  }

  async clearSessionMemory(sessionId: string): Promise<void> {
    await this.memoryService.clearMemory(sessionId);
  }
}
