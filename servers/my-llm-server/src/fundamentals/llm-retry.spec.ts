import {
  COMPLETE_RETRY_DELAYS_MS,
  LlmHttpError,
  USER_CANCEL_REASON,
  UserCancelError,
  isRetryableLlmError,
  isUserCancel,
  withCompleteRetries,
  withStreamRetries,
} from './llm-retry';

describe('llm-retry', () => {
  it('429/5xx/超时/网络可重试，401 与用户取消不可重试', () => {
    expect(isRetryableLlmError(new LlmHttpError(429, 'rate'))).toBe(true);
    expect(isRetryableLlmError(new LlmHttpError(503, 'busy'))).toBe(true);
    expect(isRetryableLlmError(new LlmHttpError(401, 'nope'))).toBe(false);
    expect(isRetryableLlmError(new LlmHttpError(400, 'bad'))).toBe(false);
    expect(isRetryableLlmError(new UserCancelError())).toBe(false);
    const timeout = new DOMException('aborted', 'AbortError');
    const signal = AbortSignal.abort('timeout');
    expect(isRetryableLlmError(timeout, signal)).toBe(true);
    const cancelSignal = AbortSignal.abort(USER_CANCEL_REASON);
    expect(isUserCancel(undefined, cancelSignal)).toBe(true);
    expect(isRetryableLlmError(timeout, cancelSignal)).toBe(false);
    expect(isRetryableLlmError(new TypeError('fetch failed'))).toBe(true);
  });

  it('complete 遇可重试错误按次数重试，取消立即停', async () => {
    const sleepFn = jest.fn(async () => undefined);
    let n = 0;
    const result = await withCompleteRetries(
      async () => {
        n += 1;
        if (n < 3) throw new LlmHttpError(503, 'busy');
        return 'ok';
      },
      { sleepFn, delaysMs: COMPLETE_RETRY_DELAYS_MS },
    );
    expect(result).toBe('ok');
    expect(n).toBe(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);

    const cancelled = AbortSignal.abort(USER_CANCEL_REASON);
    await expect(
      withCompleteRetries(async () => 'x', { signal: cancelled, sleepFn }),
    ).rejects.toBeInstanceOf(UserCancelError);
  });

  it('stream 已吐字后不再重打；零 chunk 才重试', async () => {
    const sleepFn = jest.fn(async () => undefined);
    let attempts = 0;
    const chunks: string[] = [];
    async function* once() {
      attempts += 1;
      if (attempts === 1) throw new LlmHttpError(502, 'bad gateway');
      yield 'hello';
    }
    for await (const c of withStreamRetries(() => once(), { extraAttempts: 1, sleepFn })) {
      chunks.push(c);
    }
    expect(attempts).toBe(2);
    expect(chunks).toEqual(['hello']);

    attempts = 0;
    async function* alreadyYielded() {
      attempts += 1;
      yield 'a';
      throw new LlmHttpError(503, 'later');
    }
    const got: string[] = [];
    await expect(async () => {
      for await (const c of withStreamRetries(() => alreadyYielded(), { extraAttempts: 1, sleepFn })) {
        got.push(c);
      }
    }).rejects.toBeInstanceOf(LlmHttpError);
    expect(attempts).toBe(1);
    expect(got).toEqual(['a']);
  });
});
