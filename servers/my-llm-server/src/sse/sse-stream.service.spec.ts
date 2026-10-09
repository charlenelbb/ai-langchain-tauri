import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserCancelError } from '../fundamentals/llm-retry';
import { StreamIdempotencyStore } from './stream-idempotency';

jest.mock('../cs/cs.service', () => ({
  CsService: class CsService {},
}));

import { SseStreamService } from './sse-stream.service';

function waitFor(pred: () => boolean, ms = 1500): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (pred()) return resolve();
      if (Date.now() - start > ms) return reject(new Error('wait timeout'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe('stream idempotency + cancel', () => {
  it('同一 user+key 复用 streamId，跨用户不能命中', () => {
    const store = new StreamIdempotencyStore(60_000);
    store.set('user-a', 'key-1', 'stream-1');
    expect(store.get('user-a', 'key-1')).toBe('stream-1');
    expect(store.get('user-b', 'key-1')).toBeUndefined();
    expect(store.get('user-a', 'key-2')).toBeUndefined();
  });

  it('取消会 abort 上游，且不 persist、不转人工', async () => {
    const persistTurn = jest.fn();
    const applyHandoffAfterTurn = jest.fn();
    const prepareTurn = jest.fn(async () => ({
      intent: 'complaint',
      grounded: true,
      suggestTicket: true,
      wantHandoff: true,
      citations: [],
      historyContext: '',
      question: '转人工',
      kbId: 'customer-service',
    }));
    const streamAnswer = jest.fn((_prepared: unknown, opts?: { signal?: AbortSignal }) => {
      return (async function* () {
        await new Promise<void>((_resolve, reject) => {
          const signal = opts?.signal;
          if (!signal || signal.aborted) {
            reject(new UserCancelError());
            return;
          }
          signal.addEventListener('abort', () => reject(new UserCancelError()));
        });
      })();
    });
    const svc = new SseStreamService({
      prepareTurn,
      streamAnswer,
      persistTurn,
      applyHandoffAfterTurn,
    } as any);

    svc.startCustomerServiceStream('sid-1', {
      question: '转人工',
      sessionId: 'sess-1',
      userId: 'user-a',
    });
    await waitFor(() => Boolean(prepareTurn.mock.calls.length));
    const state = svc.getStream('sid-1');
    expect(state?.upstream.signal.aborted).toBe(false);
    svc.cancelStream('sid-1', 'user-a');
    expect(state?.cancelled).toBe(true);
    expect(state?.upstream.signal.aborted).toBe(true);
    await waitFor(() => Boolean(state?.done));
    expect(persistTurn).not.toHaveBeenCalled();
    expect(applyHandoffAfterTurn).not.toHaveBeenCalled();
  });

  it('别人不能 cancel', () => {
    const svc = new SseStreamService({
      prepareTurn: jest.fn(async () => ({})),
      streamAnswer: jest.fn(async function* () {
        yield { type: 'chunk', chunk: 'x' };
      }),
      persistTurn: jest.fn(),
      applyHandoffAfterTurn: jest.fn(),
    } as any);
    svc.startCustomerServiceStream('sid-2', {
      question: 'hi',
      userId: 'user-a',
    });
    expect(() => svc.cancelStream('sid-2', 'user-b')).toThrow(ForbiddenException);
    expect(() => svc.cancelStream('missing', 'user-a')).toThrow(NotFoundException);
  });
});
