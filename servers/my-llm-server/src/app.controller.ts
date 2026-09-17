import {
  Controller,
  Get,
  Query,
  Res,
  Post,
  Body,
  Param,
  Delete,
  Patch,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppService } from './app.service';
import { SseStreamService } from './sse/sse-stream.service';
import { Public } from './auth/roles.decorator';
import { CurrentUser } from './auth/current-user.decorator';
import type { AuthUser } from './auth/auth.types';
import { CsService } from './cs/cs.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly sseStreamService: SseStreamService,
    private readonly csService: CsService,
  ) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * 可恢复 SSE：仅订阅已有 streamId（由 POST /cs/stream/start 创建）。
   * Last-Event-ID 或 ?lastEventId= 用于断点续传。
   */
  @Get('sse/stream')
  async sseStream(
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: AuthUser,
    @Query('streamId') streamId?: string,
  ): Promise<void> {
    await this.sseStreamService.handleStream(req, res, {
      streamId,
      userId: user.id,
    });
  }

  @Get('sse/session/:sessionId/stream')
  async sseSessionStream(
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: AuthUser,
    @Param('sessionId') sessionId: string,
    @Query('streamId') streamId?: string,
  ): Promise<void> {
    await this.csService.assertCanAccessSession(sessionId, user);
    await this.sseStreamService.handleStream(req, res, {
      sessionId,
      streamId,
      userId: user.id,
    });
  }

  @Get('sessions')
  async listSessions(@CurrentUser() user: AuthUser, @Query('kind') kind?: string) {
    const sessions = await this.appService.listSessions(
      kind,
      user.role === 'agent' ? undefined : user.id,
    );
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      kind: s.kind,
      intent: s.intent,
      userId: s.userId,
      botPaused: s.botPaused,
      messageCount: s.messageCount,
      lastMessage: s.lastMessage || '',
      lastSender: s.lastSender || null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  @Post('sessions')
  async createSession(
    @CurrentUser() user: AuthUser,
    @Body('title') title: string,
    @Body('kind') kind?: string,
  ) {
    return await this.appService.createSession(title, kind, user.id);
  }

  @Get('sessions/:id')
  async getSession(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.csService.assertCanAccessSession(id, user);
    const s = await this.appService.getSession(id);
    if (!s) return { error: 'not_found' };
    return s;
  }

  @Post('sessions/:id/messages')
  async appendMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    await this.csService.assertCanAccessSession(id, user);
    if (user.role !== 'agent' && body?.sender === 'agent') {
      throw new ForbiddenException('客户不能以坐席身份发消息');
    }
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
  async updateSession(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body('title') title: string,
  ) {
    await this.csService.assertCanAccessSession(id, user);
    const s = await this.appService.updateSessionTitle(id, title);
    if (!s) return { error: 'not_found' };
    return s;
  }

  @Delete('sessions/:id')
  async deleteSession(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.csService.assertCanAccessSession(id, user);
    const ok = await this.appService.deleteSession(id);
    return { ok };
  }
}
