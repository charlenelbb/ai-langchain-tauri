import {
  callDashScopeChatComplete,
  callDashScopeChatStream,
  getDashScopeApiKey,
  getDashScopeBaseUrl,
  type DashScopeChatMessage,
} from '../fundamentals/dashscope-chat';
import {
  UserCancelError,
  isUserCancel,
  throwIfCancelled,
  withCompleteRetries,
  withStreamRetries,
} from '../fundamentals/llm-retry';
import type { CsPrepareResult } from './cs.types';

export type CsLlmChunk = { type: 'thinking' | 'chunk'; chunk: string };

export function shouldTryFallbackModel(opts: {
  cancelled: boolean;
  yieldedTokens: boolean;
  fallbackModel: string | null;
}): boolean {
  return Boolean(opts.fallbackModel) && !opts.cancelled && !opts.yieldedTokens;
}

export async function rewriteWithModelFallback(options: {
  prepared: CsPrepareResult;
  snippetFallback: string;
  primaryModel: string;
  fallbackModel: string | null;
  signal?: AbortSignal;
  completeFn?: typeof callDashScopeChatComplete;
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<string> {
  const completeFn = options.completeFn ?? callDashScopeChatComplete;
  const messages: DashScopeChatMessage[] = [
    {
      role: 'system',
      content:
        '你是客服。只用摘录改写成一两句口语短答，禁止编造数字和政策。不要重复无关条款。',
    },
    {
      role: 'user',
      content: `问题：${options.prepared.question}\n摘录：\n${options.prepared.citations
        .slice(0, 2)
        .map((c) => c.snippet)
        .join('\n')}`,
    },
  ];

  const run = (model: string) =>
    withCompleteRetries(
      () =>
        completeFn({
          model,
          enableThinking: false,
          timeoutMs: 8000,
          messages,
          signal: options.signal,
        }),
      { signal: options.signal, sleepFn: options.sleepFn },
    );

  throwIfCancelled(options.signal);
  try {
    const rewritten = await run(options.primaryModel);
    if (rewritten?.trim()) return rewritten.trim();
  } catch (e) {
    if (isUserCancel(e, options.signal)) {
      throw e instanceof UserCancelError ? e : new UserCancelError();
    }
  }

  if (shouldTryFallbackModel({
    cancelled: isUserCancel(undefined, options.signal),
    yieldedTokens: false,
    fallbackModel: options.fallbackModel,
  })) {
    try {
      const rewritten = await run(options.fallbackModel as string);
      if (rewritten?.trim()) return rewritten.trim();
    } catch (e) {
      if (isUserCancel(e, options.signal)) {
        throw e instanceof UserCancelError ? e : new UserCancelError();
      }
    }
  }

  return options.snippetFallback;
}

export async function* streamWithModelFallback(options: {
  messages: DashScopeChatMessage[];
  primaryModel: string;
  fallbackModel: string | null;
  snippetFallback: string;
  signal?: AbortSignal;
  streamFn?: typeof callDashScopeChatStream;
  sleepFn?: (ms: number) => Promise<void>;
}): AsyncGenerator<CsLlmChunk, void, unknown> {
  const streamFn = options.streamFn ?? callDashScopeChatStream;
  const apiKey = getDashScopeApiKey();
  const baseUrl = getDashScopeBaseUrl();

  const streamModel = (model: string) =>
    withStreamRetries(
      () =>
        streamFn(apiKey, baseUrl, options.messages, model, {
          enableThinking: false,
          signal: options.signal,
        }),
      { extraAttempts: 1, signal: options.signal, sleepFn: options.sleepFn },
    );

  let yieldedTokens = false;
  try {
    for await (const item of streamModel(options.primaryModel)) {
      if (item.chunk) yieldedTokens = true;
      yield item;
    }
    if (yieldedTokens) return;
  } catch (e) {
    if (isUserCancel(e, options.signal)) {
      throw e instanceof UserCancelError ? e : new UserCancelError();
    }
    if (yieldedTokens) return;
  }

  if (
    shouldTryFallbackModel({
      cancelled: isUserCancel(undefined, options.signal),
      yieldedTokens,
      fallbackModel: options.fallbackModel,
    })
  ) {
    try {
      for await (const item of streamModel(options.fallbackModel as string)) {
        if (item.chunk) yieldedTokens = true;
        yield item;
      }
      if (yieldedTokens) return;
    } catch (e) {
      if (isUserCancel(e, options.signal)) {
        throw e instanceof UserCancelError ? e : new UserCancelError();
      }
      if (yieldedTokens) return;
    }
  }

  if (!yieldedTokens && options.snippetFallback) {
    yield { type: 'chunk', chunk: options.snippetFallback };
  }
}
