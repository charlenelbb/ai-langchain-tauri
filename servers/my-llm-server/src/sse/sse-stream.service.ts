import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter } from 'events';
import type { Request, Response } from 'express';
import { CsService } from '../cs/cs.service';
import { USER_CANCEL_REASON, isUserCancel } from '../fundamentals/llm-retry';
import { StreamIdempotencyStore } from './stream-idempotency';

export type SseEventRecord = {
  id: number;
  event: string;
  data: string;
};

type StreamState = {
  streamId: string;
  userId?: string;
  sessionId?: string;
  events: SseEventRecord[];
  seq: number;
  emitter: EventEmitter;
  done: boolean;
  cancelled: boolean;
  upstream: AbortController;
};

/**
 * 可恢复的 SSE：后台持续消费 LLM 流并写入缓冲，断线后同一 streamId 可重连续传。
 */
@Injectable()
export class SseStreamService {
  private readonly streams = new Map<string, StreamState>();
  private readonly maxBuffered = 5000;
  private readonly streamTtlMs = 5 * 60 * 1000;
  readonly idempotency = new StreamIdempotencyStore();

  constructor(private readonly csService: CsService) {}

  /**
   * 仅订阅已有流。lastEventId：优先 Last-Event-ID 头，其次 query.lastEventId。
   */
  async handleStream(
    req: Request,
    res: Response,
    options: {
      sessionId?: string;
      streamId?: string;
      userId?: string;
    },
  ): Promise<void> {
    const headerId = req.headers['last-event-id'];
    const rawQueryLast = req.query['lastEventId'];
    const queryLast = Array.isArray(rawQueryLast) ? rawQueryLast[0] : rawQueryLast;
    const parsedHeader =
      headerId != null && headerId !== ''
        ? parseInt(String(headerId), 10)
        : NaN;
    const parsedQuery =
      queryLast != null && queryLast !== ''
        ? parseInt(String(queryLast), 10)
        : NaN;
    let lastEventId = 0;
    if (Number.isFinite(parsedHeader) && parsedHeader >= 0) {
      lastEventId = parsedHeader;
    } else if (Number.isFinite(parsedQuery) && parsedQuery >= 0) {
      lastEventId = parsedQuery;
    }

    const streamId = options.streamId?.trim();
    if (!streamId) {
      res.status(400).json({ error: 'stream_id_required' });
      return;
    }

    const state = this.streams.get(streamId);
    if (!state) {
      res.status(404).json({ error: 'stream_not_found' });
      return;
    }
    if (state.userId && state.userId !== options.userId) {
      res.status(403).json({ error: 'stream_forbidden' });
      return;
    }
    this.setSseHeaders(res);
    await this.subscribeToStream(req, res, state, lastEventId);
  }

  private setSseHeaders(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no');
  }

  private createStreamState(
    streamId: string,
    extra?: { userId?: string; sessionId?: string },
  ): StreamState {
    return {
      streamId,
      userId: extra?.userId,
      sessionId: extra?.sessionId,
      events: [],
      seq: 0,
      emitter: new EventEmitter(),
      done: false,
      cancelled: false,
      upstream: new AbortController(),
    };
  }

  private pushEvent(
    state: StreamState,
    event: string,
    data: string,
  ): SseEventRecord {
    const id = ++state.seq;
    const ev: SseEventRecord = { id, event, data };
    state.events.push(ev);
    if (state.events.length > this.maxBuffered) {
      state.events.shift();
    }
    state.emitter.emit('event', ev);
    return ev;
  }

  getStream(streamId: string): StreamState | undefined {
    return this.streams.get(streamId);
  }

  cancelStream(streamId: string, userId: string): { ok: true; cancelled: true } {
    const state = this.streams.get(streamId);
    if (!state) {
      throw new NotFoundException('stream_not_found');
    }
    if (state.userId && state.userId !== userId) {
      throw new ForbiddenException('stream_forbidden');
    }
    state.cancelled = true;
    if (!state.upstream.signal.aborted) {
      state.upstream.abort(USER_CANCEL_REASON);
    }
    return { ok: true, cancelled: true };
  }

  /**
   * 客服流：意图分类 + RAG grounding 后推 intent/citations，再流式生成。
   */
  startCustomerServiceStream(
    streamId: string,
    opts: {
      question: string;
      sessionId?: string;
      kbId?: string;
      userId?: string;
    },
  ): void {
    const state = this.createStreamState(streamId, {
      userId: opts.userId,
      sessionId: opts.sessionId,
    });
    this.streams.set(streamId, state);
    this.pushEvent(
      state,
      'meta',
      JSON.stringify({ streamId, kind: 'customer-service' }),
    );
    this.pushEvent(
      state,
      'status',
      JSON.stringify({ phase: 'retrieving' }),
    );

    void (async () => {
      try {
        const question = (opts.question || '').trim();
        const prepared = await this.csService.prepareTurn({
          question,
          sessionId: opts.sessionId,
          kbId: opts.kbId,
        });

        if (state.cancelled) {
          this.pushCancelled(state);
          return;
        }

        this.pushEvent(
          state,
          'intent',
          JSON.stringify({ intent: prepared.intent }),
        );
        this.pushEvent(
          state,
          'citations',
          JSON.stringify({
            grounded: prepared.grounded,
            suggestTicket: prepared.suggestTicket,
            kbId: prepared.kbId,
            citations: prepared.citations,
          }),
        );

        let fullContent = '';
        for await (const item of this.csService.streamAnswer(prepared, {
          signal: state.upstream.signal,
        })) {
          if (state.cancelled) break;
          if (item.type === 'chunk') fullContent += item.chunk;
          this.pushEvent(
            state,
            'message',
            JSON.stringify({ type: item.type, chunk: item.chunk }),
          );
        }

        if (state.cancelled) {
          this.pushCancelled(state);
          return;
        }

        if (opts.sessionId && !state.cancelled) {
          await this.csService.persistTurn({
            sessionId: opts.sessionId,
            question,
            answer: fullContent,
            prepared,
          });
          if (prepared.wantHandoff && !state.cancelled) {
            await this.csService.applyHandoffAfterTurn({
              sessionId: opts.sessionId,
              userId: opts.userId,
              question,
            });
          }
        }
        if (state.cancelled) {
          this.pushCancelled(state);
          return;
        }

        this.pushEvent(
          state,
          'done',
          JSON.stringify({
            ok: true,
            intent: prepared.intent,
            grounded: prepared.grounded,
            suggestTicket: prepared.suggestTicket,
            botPaused: Boolean(prepared.wantHandoff),
          }),
        );
      } catch (e) {
        if (state.cancelled || isUserCancel(e, state.upstream.signal)) {
          state.cancelled = true;
          this.pushCancelled(state);
          return;
        }
        const msg = e instanceof Error ? e.message : String(e);
        this.pushEvent(state, 'stream_error', JSON.stringify({ error: msg }));
      } finally {
        this.finalizeStream(state);
      }
    })();
  }

  private pushCancelled(state: StreamState): void {
    this.pushEvent(
      state,
      'done',
      JSON.stringify({ ok: true, cancelled: true }),
    );
  }

  private finalizeStream(state: StreamState): void {
    state.done = true;
    setTimeout(() => {
      if (this.streams.get(state.streamId) === state) {
        this.streams.delete(state.streamId);
      }
    }, this.streamTtlMs).unref?.();
  }

  private formatSse(ev: SseEventRecord): string {
    let out = `id: ${ev.id}\n`;
    out += `event: ${ev.event}\n`;
    for (const line of ev.data.split('\n')) {
      out += `data: ${line}\n`;
    }
    return `${out}\n`;
  }

  private subscribeToStream(
    req: Request,
    res: Response,
    state: StreamState,
    lastEventId: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      let closed = false;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(hb);
        state.emitter.off('event', onEvent);
        resolve();
      };

      req.on('close', cleanup);
      req.on('aborted', cleanup);

      const hb = setInterval(() => {
        if (closed || res.writableEnded) return;
        res.write('event: ping\ndata: {}\n\n');
      }, 15_000);

      const endIfNeeded = () => {
        if (closed || res.writableEnded) return;
        cleanup();
        res.end();
      };

      const onEvent = (ev: SseEventRecord) => {
        if (closed) return;
        if (ev.id <= lastEventId) return;
        res.write(this.formatSse(ev));
        if (ev.event === 'done' || ev.event === 'stream_error') {
          endIfNeeded();
        }
      };

      for (const ev of state.events) {
        if (ev.id <= lastEventId) continue;
        res.write(this.formatSse(ev));
        if (ev.event === 'done' || ev.event === 'stream_error') {
          endIfNeeded();
          return;
        }
      }

      if (state.done) {
        endIfNeeded();
        return;
      }

      state.emitter.on('event', onEvent);
    });
  }
}
