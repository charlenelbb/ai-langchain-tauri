import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CsService } from './cs.service';
import { SseStreamService } from '../sse/sse-stream.service';
import { CS_KB_ID } from './cs.types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { assertRateLimit } from '../auth/rate-limit';

@Controller('cs')
export class CsController {
  constructor(
    private readonly csService: CsService,
    private readonly sseStreamService: SseStreamService,
  ) {}

  /**
   * 客服流：立即返回 streamId，前端订阅 GET /sse/stream?streamId=
   */
  @Post('stream/start')
  async streamStart(
    @CurrentUser() user: AuthUser,
    @Body('question') question: string,
    @Body('sessionId') sessionId?: string,
    @Body('kbId') kbId?: string,
  ) {
    if (!assertRateLimit(`stream:${user.id}`, 20, 60_000)) {
      throw new HttpException('提问过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (sessionId) {
      const session = await this.csService.assertCanAccessSession(sessionId, user);
      if (session.botPaused) {
        throw new ConflictException('已转人工，机器人暂停作答。请等待坐席回复。');
      }
    }
    const streamId = randomUUID();
    this.sseStreamService.startCustomerServiceStream(streamId, {
      question: question ?? '',
      sessionId,
      kbId: kbId || CS_KB_ID,
      userId: user.id,
    });
    return { streamId };
  }

  @Post('tickets')
  async createTicket(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      title?: string;
      description?: string;
      intent?: string;
      sessionId?: string;
      kbId?: string;
      notes?: string;
    },
  ) {
    return await this.csService.createTicket(user, body || {});
  }

  @Get('tickets')
  async listTickets(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return await this.csService.listTickets(user, status);
  }

  @Get('tickets/:id')
  async getTicket(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return await this.csService.getTicket(user, id);
  }

  @Patch('tickets/:id')
  @Roles('agent')
  async updateTicket(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { status?: string; notes?: string; title?: string },
  ) {
    return await this.csService.updateTicket(user, id, body || {});
  }

  @Post('tickets/:id/claim')
  @Roles('agent')
  async claimTicket(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return await this.csService.claimTicket(user, id);
  }

  @Post('sessions/:id/handoff')
  async handoff(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body('paused') paused?: boolean,
  ) {
    return await this.csService.setHandoff(user, id, paused !== false);
  }

  @Post('sessions/:id/agent-reply')
  @Roles('agent')
  async agentReply(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body('text') text?: string,
  ) {
    return await this.csService.replyAsAgent(user, id, text || '');
  }

  @Post('sessions/:id/follow-up')
  async customerFollowUp(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body('text') text?: string,
  ) {
    return await this.csService.addCustomerFollowUp(user, id, text || '');
  }
}
