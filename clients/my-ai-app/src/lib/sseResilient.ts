/**
 * 可恢复 SSE：fetch + ReadableStream 解析（避免 Tauri/WebView 里 EventSource 对 Last-Event-ID / 跨域不可靠）
 * 与 GET /sse/stream 或 /sse/session/:id/stream 配合；断线后同一 URL（含 streamId + lastEventId query）重连。
 */

export type ResilientSseHandlers = {
  onMeta?: (streamId: string) => void;
  onMessageChunk?: (chunk: string) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
  onRetry?: (attempt: number, delayMs: number) => void;
  onGiveUp?: () => void;
};

export type ResilientSseOptions = {
  baseUrl: string;
  query?: string;
  sessionId?: string;
  initialStreamId?: string;
  maxRetries: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  handlers: ResilientSseHandlers;
};

function buildStreamUrl(opts: {
  baseUrl: string;
  query?: string;
  sessionId?: string;
  streamId: string | null;
  lastEventId: number;
}): string {
  const path = opts.sessionId
    ? `/sse/session/${encodeURIComponent(opts.sessionId)}/stream`
    : '/sse/stream';
  const u = new URL(path, opts.baseUrl.replace(/\/$/, '') + '/');
  if (opts.streamId) {
    u.searchParams.set('streamId', opts.streamId);
    u.searchParams.set('lastEventId', String(opts.lastEventId));
  } else {
    if (!opts.query?.trim()) {
      throw new Error('query is required when streamId is empty');
    }
    u.searchParams.set('query', opts.query);
  }
  return u.toString();
}

/** 解析单个 SSE 事件块（不含外层 \n\n 分隔符） */
function parseEventBlock(block: string): {
  id: number | null;
  event: string;
  data: string;
} {
  let idStr: string | undefined;
  let eventName = 'message';
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(':')) continue;
    const t = line.trimEnd();
    if (t.startsWith('id:')) {
      idStr = t.slice(3).trimStart();
      continue;
    }
    if (t.startsWith('event:')) {
      eventName = t.slice(6).trimStart();
      continue;
    }
    if (t.startsWith('data:')) {
      const rest = line.slice(line.indexOf('data:') + 5);
      dataLines.push(rest.startsWith(' ') ? rest.slice(1) : rest);
    }
  }
  const data = dataLines.join('\n');
  let id: number | null = null;
  if (idStr != null && idStr !== '') {
    const n = parseInt(idStr, 10);
    if (Number.isFinite(n)) id = n;
  }
  return { id, event: eventName, data };
}

export function connectResilientSse(options: ResilientSseOptions): () => void {
  const {
    baseUrl,
    query,
    sessionId,
    initialStreamId,
    maxRetries,
    initialBackoffMs,
    maxBackoffMs,
    handlers,
  } = options;

  let streamId: string | null = initialStreamId ?? null;
  let lastEventId = 0;
  let attempt = 0;
  let closed = false;
  let finished = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;
  let abortController: AbortController | null = null;
  let lastRxAt = Date.now();
  /** 每次 connectOnce 递增；旧连接 abort 后的 catch 若代数已变则不得再调度重连 */
  let connectGen = 0;

  const onOnline = () => {
    if (closed || finished) return;
    clearRetry();
    abortController?.abort();
    scheduleReconnectImmediate();
  };

  const onOffline = () => {
    if (closed || finished) return;
    abortController?.abort();
  };

  const clearRetry = () => {
    if (retryTimer != null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const clearWatchdog = () => {
    if (watchdogTimer != null) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
  };

  const cleanup = () => {
    closed = true;
    finished = true;
    clearRetry();
    clearWatchdog();
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    }
    abortController?.abort();
    abortController = null;
  };

  const bumpRx = () => {
    lastRxAt = Date.now();
  };

  const dispatchBlock = (rawBlock: string) => {
    const block = rawBlock.trim();
    if (!block) return;
    const { id, event: eventName, data } = parseEventBlock(block);
    if (id != null) lastEventId = Math.max(lastEventId, id);
    bumpRx();

    switch (eventName) {
      case 'meta':
        try {
          const parsed = JSON.parse(data) as { streamId?: string };
          if (parsed.streamId) {
            streamId = parsed.streamId;
            handlers.onMeta?.(parsed.streamId);
          }
        } catch {
          handlers.onError?.('invalid meta payload');
        }
        break;
      case 'message':
        handlers.onMessageChunk?.(data);
        break;
      case 'ping':
        break;
      case 'done':
        finished = true;
        handlers.onDone?.();
        cleanup();
        break;
      case 'stream_error':
        try {
          const parsed = JSON.parse(data) as { error?: string };
          if (parsed.error) handlers.onError?.(parsed.error);
        } catch {
          handlers.onError?.('stream_error');
        }
        cleanup();
        break;
      default:
        break;
    }
  };

  const scheduleRetry = () => {
    if (closed || finished) return;
    clearRetry();
    if (attempt >= maxRetries) {
      handlers.onGiveUp?.();
      return;
    }
    const delay = Math.min(
      initialBackoffMs * Math.pow(2, attempt),
      maxBackoffMs,
    );
    attempt += 1;
    handlers.onRetry?.(attempt, delay);
    retryTimer = setTimeout(() => {
      if (closed || finished) return;
      void connectOnce();
    }, delay);
  };

  /** 看门狗 / 网络恢复触发的 abort：立即重连，不计入退避失败次数 */
  const scheduleReconnectImmediate = () => {
    if (closed || finished) return;
    clearRetry();
    retryTimer = setTimeout(() => {
      if (closed || finished) return;
      void connectOnce();
    }, 0);
  };

  const connectOnce = async () => {
    if (closed || finished) return;
    const op = ++connectGen;
    clearWatchdog();
    abortController?.abort();
    abortController = new AbortController();
    const signal = abortController.signal;

    let url: string;
    try {
      url = buildStreamUrl({
        baseUrl,
        query,
        sessionId,
        streamId,
        lastEventId,
      });
    } catch (e) {
      handlers.onError?.(e instanceof Error ? e.message : String(e));
      return;
    }

    bumpRx();
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        signal,
      });
    } catch (e) {
      if (closed) return;
      if (op !== connectGen) return;
      const isAbort =
        (e instanceof Error && e.name === 'AbortError') ||
        (typeof DOMException !== 'undefined' &&
          e instanceof DOMException &&
          e.name === 'AbortError');
      if (isAbort && !finished) scheduleReconnectImmediate();
      else if (!finished) scheduleRetry();
      return;
    }

    if (!res.ok) {
      scheduleRetry();
      return;
    }

    const body = res.body;
    if (!body) {
      scheduleRetry();
      return;
    }

    attempt = 0;
    bumpRx();

    watchdogTimer = setInterval(() => {
      if (closed || finished) return;
      if (Date.now() - lastRxAt > 45_000) {
        abortController?.abort();
      }
    }, 5_000);

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    let retryScheduledInCatch = false;
    try {
      while (!closed && !finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, '\n');
        while (true) {
          const sep = buffer.indexOf('\n\n');
          if (sep === -1) break;
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          dispatchBlock(block);
          if (finished) return;
        }
      }
      if (buffer.trim() && !finished) {
        dispatchBlock(buffer);
      }
    } catch (e) {
      if (closed) return;
      if (op !== connectGen) return;
      retryScheduledInCatch = true;
      const isAbort =
        (e instanceof Error && e.name === 'AbortError') ||
        (typeof DOMException !== 'undefined' &&
          e instanceof DOMException &&
          e.name === 'AbortError');
      if (isAbort) {
        if (!finished && op === connectGen) scheduleReconnectImmediate();
        return;
      }
      if (!finished) scheduleRetry();
      return;
    } finally {
      clearWatchdog();
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }

    if (
      op === connectGen &&
      !closed &&
      !finished &&
      !retryScheduledInCatch
    ) {
      scheduleRetry();
    }
  };

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
  }

  try {
    void connectOnce();
  } catch (e) {
    handlers.onError?.(e instanceof Error ? e.message : String(e));
  }

  return cleanup;
}
