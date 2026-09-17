import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { RagService } from '../rag.service';
import { MemoryService, SESSION_KIND_CS } from '../memory.service';
import { PrismaService } from '../prisma.service';
import {
  callDashScopeChatComplete,
  callDashScopeChatStream,
  getDashScopeApiKey,
  getDashScopeBaseUrl,
} from '../fundamentals/dashscope-chat';
import {
  CS_INTENTS,
  CS_KB_ID,
  CS_MAX_COSINE_DISTANCE,
  getCsTextModel,
  isCsIntent,
  isTicketStatus,
  type CsCitation,
  type CsIntent,
  type CsPrepareResult,
  type TicketStatus,
} from './cs.types';
import {
  HANDOFF_CONFIRM,
  REFUSE_MESSAGE,
  classifyIntentByRules,
  isHandoffRequest,
  rewriteFromSnippets,
  shouldExtractiveAnswer,
} from './cs-policy';
import { canCustomerFollowUp } from './cs-view';
import type { AuthUser } from '../auth/auth.types';
import { isUserRole } from '../auth/auth.types';
import { AuditService } from '../auth/audit.service';

const CS_DEFAULT_TOP_K = 6;
const SNIPPET_MAX = 1200;
const SHIPPING_QUERY_RE = /发货|物流|时效|多久.*货|什么时候.*货|几天.*到/;
const SHIPPING_WINDOW_TERMS = ['发货', '物流', '时效', '工作日', '付款后'];
const TICKET_NAME_INCLUDE = {
  user: { select: { username: true } },
  assignee: { select: { username: true } },
} as const;

function expandSearchQuery(query: string): string {
  if (SHIPPING_QUERY_RE.test(query)) {
    return `${query} 发货 物流 时效 什么时候发货`;
  }
  return query;
}

function snippetKeywords(question: string): string[] {
  const fromQ = question
    .replace(/[？?，,。！!、；;：:\s]+/g, ' ')
    .split(' ')
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  const extras = SHIPPING_QUERY_RE.test(question) ? SHIPPING_WINDOW_TERMS : [];
  return [...fromQ, ...extras];
}

/** 优先整段交给模型；超长时在段内定位与问题重叠的词再取窗口，避免只截开头。 */
function excerptSnippet(pageContent: string, question: string): string {
  const text = String(pageContent || '').trim();
  if (text.length <= SNIPPET_MAX) return text;

  let best = -1;
  for (const kw of snippetKeywords(question)) {
    const i = text.indexOf(kw);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  if (best < 0) return text.slice(0, SNIPPET_MAX);
  const start = Math.max(0, best - 160);
  return text.slice(start, start + SNIPPET_MAX);
}

function toneHint(intent: CsIntent): string {
  switch (intent) {
    case 'presale':
      return '语气专业简洁，可介绍套餐差异，但价格与库存必须以摘录为准。';
    case 'aftersale':
      return '语气清晰可执行，按政策逐步说明退换货/物流步骤。';
    case 'complaint':
      return '先共情再给可执行方案，并明确告知可转人工工单。';
    default:
      return '语气礼貌克制，不确定时明确说不知道。';
  }
}

function buildCsSystemPrompt(intent: CsIntent, excerpts: string): string {
  return `你是公司智能客服，只根据【知识库摘录】用中文回答用户。
约束：
- 禁止编造价格、政策、物流时效、库存；摘录没有的信息必须说不知道。
- 摘录里已写明的数字、时效、条款必须直接使用，不要因为谨慎而声称知识库没有。
- 回答尽量引用摘录中的具体条款。
- ${toneHint(intent)}

【知识库摘录】
${excerpts || '（无）'}`;
}

@Injectable()
export class CsService {
  private readonly logger = new Logger('CsService');

  constructor(
    private readonly ragService: RagService,
    private readonly memoryService: MemoryService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  classifyIntent(question: string): CsIntent {
    return classifyIntentByRules(question);
  }

  /**
   * pgvector cosine 距离越小越相近。同时在应用层再按 kbId 过滤，
   * 因为部分版本会忽略 metadata filter。
   */
  private isGrounded(scores: number[]): boolean {
    if (!scores.length) return false;
    const best = Math.min(...scores);
    this.logger.log(
      `RAG scores=${scores.map((s) => s.toFixed(4)).join(',')} best=${best.toFixed(4)} threshold(maxDistance)=${CS_MAX_COSINE_DISTANCE}`,
    );
    return best <= CS_MAX_COSINE_DISTANCE;
  }

  async prepareTurn(options: {
    question: string;
    sessionId?: string;
    kbId?: string;
    topK?: number;
  }): Promise<CsPrepareResult> {
    const question = (options.question || '').trim();
    if (!question) {
      throw new BadRequestException('question 不能为空');
    }
    const kbId = (options.kbId || CS_KB_ID).trim() || CS_KB_ID;
    const wantHandoff = isHandoffRequest(question);
    const intent = classifyIntentByRules(question);

    if (wantHandoff) {
      const historyContext = options.sessionId
        ? await this.memoryService.getMemoryContext(options.sessionId)
        : '';
      return {
        intent,
        grounded: true,
        suggestTicket: true,
        wantHandoff: true,
        citations: [],
        historyContext,
        question,
        kbId,
      };
    }

    const [search, historyContext] = await Promise.all([
      this.ragService.search(expandSearchQuery(question), {
        kbId,
        topK: options.topK ?? CS_DEFAULT_TOP_K,
      }),
      options.sessionId
        ? this.memoryService.getMemoryContext(options.sessionId)
        : Promise.resolve(''),
    ]);
    const filtered = (search.results || []).filter((r) => {
      const id = String(r.metadata?.kbId || '').trim();
      return !id || id === kbId;
    });

    const citations: CsCitation[] = filtered.map((r) => ({
      source: String(r.metadata?.source || 'unknown'),
      chunkIndex: Number(r.metadata?.chunkIndex ?? 0),
      score: Number(r.score ?? 0),
      snippet: excerptSnippet(String(r.pageContent || ''), question),
    }));

    const grounded = this.isGrounded(citations.map((c) => c.score));
    const suggestTicket = intent === 'complaint' || !grounded;

    return {
      intent,
      grounded,
      suggestTicket,
      wantHandoff: false,
      citations: grounded ? citations : [],
      refuseMessage: grounded ? undefined : REFUSE_MESSAGE,
      historyContext,
      question,
      kbId,
    };
  }

  async *streamAnswer(
    prepared: CsPrepareResult,
  ): AsyncGenerator<{ type: 'thinking' | 'chunk'; chunk: string }, void, unknown> {
    if (prepared.wantHandoff) {
      this.logger.log('CS answer path=handoff');
      yield { type: 'chunk', chunk: HANDOFF_CONFIRM };
      return;
    }

    if (!prepared.grounded) {
      yield { type: 'chunk', chunk: prepared.refuseMessage || REFUSE_MESSAGE };
      return;
    }

    if (shouldExtractiveAnswer(prepared)) {
      this.logger.log('CS answer path=extractive-rewrite');
      const fallback = rewriteFromSnippets(prepared.question, prepared.citations);
      try {
        const rewritten = await callDashScopeChatComplete({
          model: getCsTextModel(),
          enableThinking: false,
          timeoutMs: 8000,
          messages: [
            {
              role: 'system',
              content:
                '你是客服。只用摘录改写成一两句口语短答，禁止编造数字和政策。不要重复无关条款。',
            },
            {
              role: 'user',
              content: `问题：${prepared.question}\n摘录：\n${prepared.citations
                .slice(0, 2)
                .map((c) => c.snippet)
                .join('\n')}`,
            },
          ],
        });
        yield { type: 'chunk', chunk: rewritten || fallback };
      } catch {
        yield { type: 'chunk', chunk: fallback };
      }
      return;
    }

    this.logger.log(`CS answer path=llm model=${getCsTextModel()}`);

    const excerpts = prepared.citations
      .map(
        (c, i) =>
          `[#${i + 1} source=${c.source} chunk=${c.chunkIndex} distance=${c.score.toFixed(4)}]\n${c.snippet}`,
      )
      .join('\n\n');

    const userContent = prepared.historyContext?.trim()
      ? `对话历史：\n${prepared.historyContext}\n\n当前问题：${prepared.question}`
      : prepared.question;

    const apiKey = getDashScopeApiKey();
    const baseUrl = getDashScopeBaseUrl();
    yield* callDashScopeChatStream(
      apiKey,
      baseUrl,
      [
        { role: 'system', content: buildCsSystemPrompt(prepared.intent, excerpts) },
        { role: 'user', content: userContent },
      ],
      getCsTextModel(),
      { enableThinking: false },
    );
  }

  async persistTurn(options: {
    sessionId: string;
    question: string;
    answer: string;
    prepared: CsPrepareResult;
  }): Promise<void> {
    const metadata = {
      intent: options.prepared.intent,
      grounded: options.prepared.grounded,
      suggestTicket: options.prepared.suggestTicket,
      wantHandoff: options.prepared.wantHandoff,
      citations: options.prepared.citations,
      kbId: options.prepared.kbId,
    };
    await this.memoryService.addUserMessage(options.sessionId, options.question);
    await this.memoryService.addAssistantMessage(
      options.sessionId,
      options.answer,
      metadata,
    );
    await this.memoryService.updateSessionIntent(
      options.sessionId,
      options.prepared.intent,
    );
    await this.audit.log({
      action: 'cs.answer',
      resource: `session:${options.sessionId}`,
      detail: {
        intent: options.prepared.intent,
        grounded: options.prepared.grounded,
        wantHandoff: options.prepared.wantHandoff,
        sources: options.prepared.citations.map((c) => c.source),
      },
    });
  }

  async applyHandoffAfterTurn(opts: {
    sessionId: string;
    userId?: string;
    question: string;
  }) {
    let user: AuthUser | null = null;
    if (opts.userId) {
      const row = await this.prisma.client.user.findUnique({
        where: { id: opts.userId },
      });
      if (row && isUserRole(row.role)) {
        user = { id: row.id, username: row.username, role: row.role };
      }
    }
    if (user) {
      await this.createTicket(user, {
        title: `转人工：${opts.question.slice(0, 32)}`,
        description: `用户请求转人工。\n问题：${opts.question}`,
        intent: 'complaint',
        sessionId: opts.sessionId,
      });
      return;
    }
    await this.memoryService.setBotPaused(opts.sessionId, true);
  }

  mapTicket(row: {
    id: string;
    title: string;
    description: string;
    intent: string;
    status: string;
    sessionId: string | null;
    userId?: string | null;
    assigneeId?: string | null;
    kbId: string;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
    user?: { username: string } | null;
    assignee?: { username: string } | null;
  }) {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      intent: row.intent,
      status: row.status,
      sessionId: row.sessionId,
      userId: row.userId ?? null,
      assigneeId: row.assigneeId ?? null,
      customerName: row.user?.username ?? null,
      assigneeName: row.assignee?.username ?? null,
      kbId: row.kbId,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async assertCanAccessSession(sessionId: string, user: AuthUser) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('session 不存在');
    if (user.role !== 'agent' && session.userId && session.userId !== user.id) {
      throw new ForbiddenException('不能访问他人会话');
    }
    return session;
  }

  async createTicket(
    user: AuthUser,
    body: {
      title?: string;
      description?: string;
      intent?: string;
      sessionId?: string;
      kbId?: string;
      notes?: string;
    },
  ) {
    const title = (body.title || '').trim();
    const description = (body.description || '').trim();
    if (!title) throw new BadRequestException('title 不能为空');
    if (!description) throw new BadRequestException('description 不能为空');

    const intent = (body.intent || 'other').trim();
    if (!isCsIntent(intent)) {
      throw new BadRequestException(`intent 必须是 ${CS_INTENTS.join(' / ')}`);
    }

    if (body.sessionId) {
      const session = await this.assertCanAccessSession(body.sessionId, user);
      if (session.kind !== SESSION_KIND_CS) {
        throw new BadRequestException('只能从客服会话创建工单');
      }
      await this.memoryService.setBotPaused(body.sessionId, true);
    }

    const created = await this.prisma.client.ticket.create({
      data: {
        title,
        description,
        intent,
        status: 'open',
        sessionId: body.sessionId || null,
        userId: user.role === 'customer' ? user.id : undefined,
        kbId: (body.kbId || CS_KB_ID).trim() || CS_KB_ID,
        notes: body.notes?.trim() || null,
      },
      include: TICKET_NAME_INCLUDE,
    });
    await this.audit.log({
      userId: user.id,
      action: 'ticket.create',
      resource: `ticket:${created.id}`,
      detail: { sessionId: body.sessionId, intent },
    });
    return this.mapTicket(created);
  }

  async listTickets(user: AuthUser, status?: string) {
    const where: { status?: string; userId?: string } = {};
    if (status) {
      if (!isTicketStatus(status)) {
        throw new BadRequestException(`status 必须是 open / in_progress / closed`);
      }
      where.status = status;
    }
    if (user.role === 'customer') where.userId = user.id;
    const list = await this.prisma.client.ticket.findMany({
      where,
      include: TICKET_NAME_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return list.map((row) => this.mapTicket(row));
  }

  async getTicket(user: AuthUser, id: string) {
    const row = await this.prisma.client.ticket.findUnique({
      where: { id },
      include: TICKET_NAME_INCLUDE,
    });
    if (!row) throw new NotFoundException('工单不存在');
    if (user.role === 'customer' && row.userId && row.userId !== user.id) {
      throw new ForbiddenException('不能查看他人工单');
    }
    return this.mapTicket(row);
  }

  async updateTicket(
    user: AuthUser,
    id: string,
    body: { status?: string; notes?: string; title?: string },
  ) {
    const existing = await this.prisma.client.ticket.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('工单不存在');
    if (user.role === 'customer') {
      throw new ForbiddenException('客户不能修改工单状态，请等待坐席处理');
    }

    const data: { status?: TicketStatus; notes?: string; title?: string } = {};
    if (body.status != null) {
      if (!isTicketStatus(body.status)) {
        throw new BadRequestException('status 必须是 open / in_progress / closed');
      }
      data.status = body.status;
    }
    if (body.notes != null) data.notes = body.notes;
    if (body.title != null) {
      const title = body.title.trim();
      if (!title) throw new BadRequestException('title 不能为空');
      data.title = title;
    }

    const updated = await this.prisma.client.ticket.update({
      where: { id },
      data,
      include: TICKET_NAME_INCLUDE,
    });
    return this.mapTicket(updated);
  }

  async claimTicket(user: AuthUser, id: string) {
    if (user.role !== 'agent') {
      throw new ForbiddenException('只有坐席可以认领工单');
    }
    const existing = await this.prisma.client.ticket.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('工单不存在');
    const updated = await this.prisma.client.ticket.update({
      where: { id },
      data: {
        assigneeId: user.id,
        status: existing.status === 'open' ? 'in_progress' : existing.status,
      },
      include: TICKET_NAME_INCLUDE,
    });
    if (updated.sessionId) {
      await this.memoryService.setBotPaused(updated.sessionId, true);
    }
    await this.audit.log({
      userId: user.id,
      action: 'ticket.claim',
      resource: `ticket:${id}`,
    });
    return this.mapTicket(updated);
  }

  async setHandoff(user: AuthUser, sessionId: string, paused: boolean) {
    await this.assertCanAccessSession(sessionId, user);
    if (user.role === 'customer' && !paused) {
      throw new ForbiddenException('客户不能自行恢复机器人');
    }
    await this.memoryService.setBotPaused(sessionId, paused);
    await this.audit.log({
      userId: user.id,
      action: paused ? 'session.handoff' : 'session.resume_bot',
      resource: `session:${sessionId}`,
    });
    return this.memoryService.getSession(sessionId);
  }

  async addCustomerFollowUp(user: AuthUser, sessionId: string, text: string) {
    const content = (text || '').trim();
    if (!content) throw new BadRequestException('留言不能为空');
    const session = await this.assertCanAccessSession(sessionId, user);
    if (!canCustomerFollowUp(user.role, Boolean(session.botPaused))) {
      throw new ConflictException('仅在转人工后可直接留言给坐席');
    }
    await this.memoryService.addUserMessage(sessionId, content);
    await this.audit.log({
      userId: user.id,
      action: 'session.follow_up',
      resource: `session:${sessionId}`,
    });
    return this.memoryService.getSession(sessionId);
  }

  async replyAsAgent(user: AuthUser, sessionId: string, text: string) {
    if (user.role !== 'agent') {
      throw new ForbiddenException('只有坐席可以在会话中回复');
    }
    const content = (text || '').trim();
    if (!content) throw new BadRequestException('回复不能为空');
    await this.assertCanAccessSession(sessionId, user);
    await this.memoryService.setBotPaused(sessionId, true);
    await this.memoryService.addAgentMessage(sessionId, content, {
      agentId: user.id,
      agentName: user.username,
    });
    await this.audit.log({
      userId: user.id,
      action: 'session.agent_reply',
      resource: `session:${sessionId}`,
    });
    return this.memoryService.getSession(sessionId);
  }
}
