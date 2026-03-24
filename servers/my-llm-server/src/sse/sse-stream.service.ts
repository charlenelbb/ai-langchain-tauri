import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import type { Request, Response } from 'express';
import { AppService } from '../app.service';

export type SseEventRecord = {
  id: number;
  event: string;
  data: string;
};

type StreamState = {
  streamId: string;
  events: SseEventRecord[];
  seq: number;
  emitter: EventEmitter;
  done: boolean;
};

/**
 * 可恢复的 SSE：后台持续消费 LLM 流并写入缓冲，断线后同一 streamId 可重连续传。
 * 心跳使用 SSE 注释行（: ping），不占用 Last-Event-ID。
 */
@Injectable()
export class SseStreamService {
  private readonly streams = new Map<string, StreamState>();
  private readonly maxBuffered = 5000;
  private readonly streamTtlMs = 5 * 60 * 1000;

  constructor(private readonly appService: AppService) {}

  /**
   * lastEventId：优先 Last-Event-ID 头，其次 query.lastEventId（便于手动重连）
   */
  async handleStream(
    req: Request,
    res: Response,
    options: {
      query?: string;
      sessionId?: string;
      streamId?: string;
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
    const query = options.query?.trim();

    if (streamId) {
      const state = this.streams.get(streamId);
      if (!state) {
        res.status(404).json({ error: 'stream_not_found' });
        return;
      }
      this.setSseHeaders(res);
      await this.subscribeToStream(req, res, state, lastEventId);
      return;
    }

    if (!query) {
      res.status(400).json({ error: 'query_required_for_new_stream' });
      return;
    }

    this.setSseHeaders(res);

    const newId = randomUUID();
    const state = this.createStreamState(newId);
    this.streams.set(newId, state);

    this.pushEvent(state, 'meta', JSON.stringify({ streamId: newId }));

    let promptWithContext = query;
    if (options.sessionId) {
      const context = await this.appService.getSessionContext(options.sessionId);
      if (typeof context === 'string' && context.trim()) {
        promptWithContext = `上下文：\n${context}\n\n当前问题：${query}`;
      }
    }

    this.startBackgroundGeneration(state, promptWithContext);

    await this.subscribeToStream(req, res, state, lastEventId);
  }

  private setSseHeaders(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no');
  }

  private createStreamState(streamId: string): StreamState {
    return {
      streamId,
      events: [],
      seq: 0,
      emitter: new EventEmitter(),
      done: false,
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

  private startBackgroundGeneration(state: StreamState, prompt: string): void {
    void (async () => {
      try {
        const stream = this.appService.promptStream(prompt);
        for await (const chunk of stream) {
          this.pushEvent(state, 'message', chunk);
        }
        this.pushEvent(state, 'done', JSON.stringify({ ok: true }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.pushEvent(state, 'stream_error', JSON.stringify({ error: msg }));
      } finally {
        this.finalizeStream(state);
      }
    })();
  }

  /**
   * 医疗流：multipart 在 POST 中提交后，由后台写入缓冲，GET /sse/stream?streamId= 订阅。
   * message 事件的 data 为 JSON：{ type, chunk }，与旧版 POST medical/stream 一致。
   */
  startMedicalStream(
    streamId: string,
    opts: {
      fileBuffer: Buffer;
      question: string;
      rawQuestion: string;
      sessionId?: string;
    },
  ): void {
    const state = this.createStreamState(streamId);
    this.streams.set(streamId, state);
    this.pushEvent(state, 'meta', JSON.stringify({ streamId, kind: 'medical' }));

    void (async () => {
      try {
        let promptWithContext = opts.question ?? '';
        const userText = (opts.rawQuestion ?? opts.question) || '';

        if (opts.sessionId) {
          const historyContext = await this.appService.getSessionContext(
            opts.sessionId,
          );
          if (typeof historyContext === 'string' && historyContext.trim()) {
            promptWithContext =
              `上下文：\n${historyContext}\n\n当前问题：${opts.question}`.trim();
          }
          await this.appService.appendMessage(opts.sessionId, {
            sender: 'user',
            text: userText,
          });
        }

        this.pushEvent(
          state,
          'message',
          JSON.stringify({ type: 'thinking', chunk: '' }),
        );

        let fullContent = '';
        for await (const item of this.appService.medicalAnalysisStream(
          opts.fileBuffer,
          promptWithContext,
        )) {
          if (item.type === 'chunk') fullContent += item.chunk;
          this.pushEvent(
            state,
            'message',
            JSON.stringify({ type: item.type, chunk: item.chunk }),
          );
        }

        if (opts.sessionId) {
          await this.appService.appendMessage(opts.sessionId, {
            sender: 'assistant',
            text: fullContent,
          });
        }

        await this.appService.saveMedicalRecord(userText, fullContent);
        this.pushEvent(state, 'done', JSON.stringify({ ok: true }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.pushEvent(state, 'stream_error', JSON.stringify({ error: msg }));
      } finally {
        this.finalizeStream(state);
      }
    })();
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
        // 使用命名事件而非注释行：EventSource 对 : ping 不触发任何回调，客户端无法检测僵死连接
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
