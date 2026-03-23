import {
  Controller,
  Get,
  Query,
  Res,
  Post,
  Body,
  UploadedFile,
  UseInterceptors,
  Param,
  Delete,
  Patch,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('prompt')
  async prompt(@Query('message') msg: string): Promise<string> {
    return await this.appService.prompt(msg);
  }

  @Get('rag')
  async rag(@Query('query') query: string): Promise<any> {
    const response = await this.appService.rag(query);
    return response;
  }

  @Get('sse')
  async sse(
    @Query('query') query: string,
    @Res() res: Response,
  ): Promise<void> {
    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
      // 发送初始连接成功事件
      res.write('event: open\n');
      res.write(`data: SSE连接已建立\n\n`);

      // 获取流式响应
      const stream = this.appService.promptStream(query);

      // 逐个发送数据
      for await (const chunk of stream) {
        res.write('event: message\n');
        res.write(`data: ${chunk}\n\n`);
      }

      // 发送完成事件
      res.write('event: done\n');
      res.write('data: 流已完成\n\n');
      res.end();
    } catch (error) {
      res.write('event: error\n');
      res.write(
        `data: ${error instanceof Error ? error.message : '未知错误'}\n\n`,
      );
      res.end();
    }
  }

  // SSE with session context - 使用会话上下文的流式端点
  @Get('sse/:sessionId')
  async sseWithContext(
    @Param('sessionId') sessionId: string,
    @Query('query') query: string,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
      res.write('event: open\n');
      res.write(`data: SSE连接已建立\n\n`);

      // 获取会话的历史上下文
      const context = await this.appService.getSessionContext(sessionId);
      const promptWithContext = context
        ? `上下文：\n${context}\n\n当前问题：${query}`
        : query;

      // 获取流式响应
      const stream = this.appService.promptStream(promptWithContext);

      for await (const chunk of stream) {
        res.write('event: message\n');
        res.write(`data: ${chunk}\n\n`);
      }

      res.write('event: done\n');
      res.write('data: 流已完成\n\n');
      res.end();
    } catch (error) {
      res.write('event: error\n');
      res.write(
        `data: ${error instanceof Error ? error.message : '未知错误'}\n\n`,
      );
      res.end();
    }
  }

  @Get('medical/history')
  async medicalHistory(@Query('limit') limit?: string) {
    return await this.appService.listMedicalHistory(
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Post('medical')
  @UseInterceptors(FileInterceptor('image'))
  async medical(
    @UploadedFile() file: any,
    @Body('question') question: string,
    @Res() res: Response,
  ) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
      const fileBuffer = file?.buffer ? file.buffer : Buffer.alloc(0);
      const result = await this.appService.medicalAnalysis(
        fileBuffer,
        question,
      );
      return res.json({
        answer: result.content,
        reasoning: result.reasoning,
      });
    } catch (err) {
      return res
        .status(500)
        .json({ error: err instanceof Error ? err.message : '处理失败' });
    }
  }

  @Post('medical/stream')
  @UseInterceptors(FileInterceptor('image'))
  async medicalStream(
    @UploadedFile() file: any,
    @Body('question') question: string,
    @Body('rawQuestion') rawQuestion: string | undefined,
    @Body('sessionId') sessionId: string | undefined,
    @Res() res: Response,
  ) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    try {
      const fileBuffer = file?.buffer ? file.buffer : Buffer.alloc(0);
      const userText = (rawQuestion ?? question) || '';

      // 让 SSE 连接尽快返回“开始事件”，避免纯文本生成等待过久导致前端侧超时。
      // 前端收到后会进入 thinking 状态，但 chunk 为空不会影响内容。
      res.write('data: ' + JSON.stringify({ type: 'thinking', chunk: '' }) + '\n\n');

      let promptWithContext = question ?? '';
      if (sessionId) {
        // 先读取历史，再追加当前用户问题到会话，避免把“当前问题”重复算进上下文
        const historyContext = await this.appService.getSessionContext(
          sessionId,
        );
        if (typeof historyContext === 'string' && historyContext.trim()) {
          promptWithContext =
            `上下文：\n${historyContext}\n\n当前问题：${question}`.trim();
        }

        // 将用户消息写入会话历史（用于下一轮上下文）
        await this.appService.appendMessage(sessionId, {
          sender: 'user',
          text: userText,
        });
      }

      let fullContent = '';
      for await (const item of this.appService.medicalAnalysisStream(
        fileBuffer,
        promptWithContext ?? '',
      )) {
        if (item.type === 'chunk') fullContent += item.chunk;
        res.write(
          'data: ' + JSON.stringify({ type: item.type, chunk: item.chunk }) + '\n\n',
        );
      }

      if (sessionId) {
        await this.appService.appendMessage(sessionId, {
          sender: 'assistant',
          text: fullContent,
        });
      }

      await this.appService.saveMedicalRecord(userText, fullContent);
      res.write('data: ' + JSON.stringify({ done: true }) + '\n\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '处理失败';
      res.write('data: ' + JSON.stringify({ error: msg }) + '\n\n');
    }
    res.end();
  }

  // Sessions API - 后端持久化对话会话
  @Get('sessions')
  async listSessions() {
    const sessions = await this.appService.listSessions();
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      // MemoryService.listSessions() 提供的是 messageCount，而不是 messages
      messageCount: s.messageCount,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  @Post('sessions')
  async createSession(@Body('title') title: string) {
    const s = await this.appService.createSession(title);
    return s;
  }

  @Get('sessions/:id')
  async getSession(@Param('id') id: string) {
    const s = await this.appService.getSession(id);
    if (!s) return { error: 'not_found' };
    return s;
  }

  @Post('sessions/:id/messages')
  async appendMessage(@Param('id') id: string, @Body() body: any) {
    // body can contain { content } or { sender, text, timestamp? }
    // Map content -> text, default sender to 'user' if not provided
    const msg = {
      sender: body.sender || 'user',
      text: body.text || body.content,
      timestamp: body.timestamp || Date.now(),
    };
    const s = await this.appService.appendMessage(id, msg);
    if (!s) return { error: 'not_found' };
    return s;
  }

  @Patch('sessions/:id')
  async updateSession(@Param('id') id: string, @Body('title') title: string) {
    const s = await this.appService.updateSessionTitle(id, title);
    if (!s) return { error: 'not_found' };
    return s;
  }

  @Delete('sessions/:id')
  async deleteSession(@Param('id') id: string) {
    const ok = await this.appService.deleteSession(id);
    return { ok };
  }
}
