export const USER_CANCEL_REASON = 'cancel';
export const TIMEOUT_ABORT_REASON = 'timeout';
export const COMPLETE_RETRY_DELAYS_MS = [300, 800];

export class LlmHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'LlmHttpError';
    this.status = status;
  }
}

export class UserCancelError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'UserCancelError';
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' &&
      err instanceof DOMException &&
      err.name === 'AbortError')
  );
}

export function isUserCancel(err?: unknown, signal?: AbortSignal): boolean {
  if (err instanceof UserCancelError) return true;
  if (signal?.aborted && signal.reason === USER_CANCEL_REASON) return true;
  if (isAbortError(err)) {
    const reason =
      signal?.reason ??
      (err instanceof Error && 'cause' in err
        ? (err as Error & { cause?: unknown }).cause
        : undefined);
    return reason === USER_CANCEL_REASON;
  }
  return false;
}

export function throwIfCancelled(signal?: AbortSignal): void {
  if (isUserCancel(undefined, signal)) {
    throw new UserCancelError();
  }
}

export function isRetryableLlmError(err: unknown, signal?: AbortSignal): boolean {
  if (isUserCancel(err, signal)) return false;
  if (err instanceof LlmHttpError) {
    return err.status === 429 || err.status === 502 || err.status === 503 || err.status === 504;
  }
  if (isAbortError(err)) {
    const reason = signal?.reason ?? (err instanceof Error && 'cause' in err
      ? (err as Error & { cause?: unknown }).cause
      : undefined);
    return reason === TIMEOUT_ABORT_REASON || reason == null;
  }
  if (err instanceof TypeError) return true;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('fetch failed') || msg.includes('network') || msg.includes('econnreset')) {
      return true;
    }
  }
  return false;
}

export function linkTimeoutSignal(
  timeoutMs: number,
  external?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onExternal = () => {
    if (!controller.signal.aborted) {
      controller.abort(external?.reason ?? USER_CANCEL_REASON);
    }
  };
  if (external) {
    if (external.aborted) {
      controller.abort(external.reason);
    } else {
      external.addEventListener('abort', onExternal);
    }
  }
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) controller.abort(TIMEOUT_ABORT_REASON);
  }, timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onExternal);
    },
  };
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withCompleteRetries<T>(
  fn: () => Promise<T>,
  options?: {
    signal?: AbortSignal;
    delaysMs?: number[];
    sleepFn?: (ms: number) => Promise<void>;
  },
): Promise<T> {
  const delays = options?.delaysMs ?? COMPLETE_RETRY_DELAYS_MS;
  const sleepFn = options?.sleepFn ?? sleep;
  const maxAttempts = delays.length + 1;
  let attempt = 0;
  while (true) {
    throwIfCancelled(options?.signal);
    try {
      return await fn();
    } catch (e) {
      if (isUserCancel(e, options?.signal)) {
        throw e instanceof UserCancelError ? e : new UserCancelError();
      }
      attempt += 1;
      if (attempt >= maxAttempts || !isRetryableLlmError(e, options?.signal)) {
        throw e;
      }
      await sleepFn(delays[attempt - 1] ?? delays[delays.length - 1]);
    }
  }
}

export async function* withStreamRetries<T>(
  factory: () => AsyncIterable<T>,
  options?: {
    extraAttempts?: number;
    signal?: AbortSignal;
    sleepFn?: (ms: number) => Promise<void>;
  },
): AsyncGenerator<T, void, unknown> {
  const extra = options?.extraAttempts ?? 1;
  const sleepFn = options?.sleepFn ?? sleep;
  const maxAttempts = extra + 1;
  let attempt = 0;
  while (true) {
    throwIfCancelled(options?.signal);
    let yielded = 0;
    try {
      for await (const item of factory()) {
        yielded += 1;
        yield item;
      }
      return;
    } catch (e) {
      if (isUserCancel(e, options?.signal)) {
        throw e instanceof UserCancelError ? e : new UserCancelError();
      }
      if (yielded > 0) throw e;
      attempt += 1;
      if (attempt >= maxAttempts || !isRetryableLlmError(e, options?.signal)) {
        throw e;
      }
      await sleepFn(COMPLETE_RETRY_DELAYS_MS[0]);
    }
  }
}
