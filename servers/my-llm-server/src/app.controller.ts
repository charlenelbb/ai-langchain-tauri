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
  Req,
  Header,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { AppService } from './app.service';
import { SseStreamService } from './sse/sse-stream.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly sseStreamService: SseStreamService,
  ) {}

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

  /**
   * 可恢复 SSE：?query= 开新流；?streamId= 续传；Last-Event-ID 或 ?lastEventId= 断点
   */
  @Get('sse/stream')
  async sseStream(
    @Req() req: Request,
    @Res() res: Response,
    @Query('query') query?: string,
    @Query('streamId') streamId?: string,
  ): Promise<void> {
    await this.sseStreamService.handleStream(req, res, { query, streamId });
  }

  @Get('sse/session/:sessionId/stream')
  async sseSessionStream(
    @Req() req: Request,
    @Res() res: Response,
    @Param('sessionId') sessionId: string,
    @Query('query') query?: string,
    @Query('streamId') streamId?: string,
  ): Promise<void> {
    await this.sseStreamService.handleStream(req, res, {
      query,
      sessionId,
      streamId,
    });
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

  /**
   * 医疗流：multipart 提交后返回 streamId，前端用 EventSource 订阅 GET /sse/stream?streamId=
   */
  @Post('medical/stream/start')
  @Header('Access-Control-Allow-Origin', '*')
  @UseInterceptors(FileInterceptor('image'))
  async medicalStreamStart(
    @UploadedFile() file: any,
    @Body('question') question: string,
    @Body('rawQuestion') rawQuestion: string | undefined,
    @Body('sessionId') sessionId: string | undefined,
  ) {
    const streamId = randomUUID();
    const fileBuffer = file?.buffer ? file.buffer : Buffer.alloc(0);
    this.sseStreamService.startMedicalStream(streamId, {
      fileBuffer,
      question: question ?? '',
      rawQuestion: rawQuestion ?? question ?? '',
      sessionId,
    });
    return { streamId };
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
