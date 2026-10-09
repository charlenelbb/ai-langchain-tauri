import { LlmHttpError, USER_CANCEL_REASON, UserCancelError } from '../fundamentals/llm-retry';
import {
  rewriteWithModelFallback,
  shouldTryFallbackModel,
  streamWithModelFallback,
} from './cs-llm';
import type { CsPrepareResult } from './cs.types';
import { getCsFallbackModel } from './cs.types';

const prepared: CsPrepareResult = {
  intent: 'aftersale',
  grounded: true,
  suggestTicket: false,
  citations: [
    {
      source: 'faq.md',
      chunkIndex: 0,
      score: 0.2,
      snippet: '普通商品付款后1-3个工作日发货',
    },
  ],
  historyContext: '',
  question: '多久发货',
  kbId: 'customer-service',
};

describe('cs-llm fallback', () => {
  const prevKey = process.env.DASHSCOPE_API_KEY;
  const prevPrimary = process.env.CS_TEXT_MODEL;
  const prevFallback = process.env.CS_FALLBACK_MODEL;

  beforeAll(() => {
    process.env.DASHSCOPE_API_KEY = 'sk-test';
  });

  afterAll(() => {
    process.env.DASHSCOPE_API_KEY = prevKey;
    process.env.CS_TEXT_MODEL = prevPrimary;
    process.env.CS_FALLBACK_MODEL = prevFallback;
  });

  it('shouldTryFallbackModel：仅 0 token 且未取消才切备用', () => {
    expect(
      shouldTryFallbackModel({
        cancelled: false,
        yieldedTokens: false,
        fallbackModel: 'qwen-plus',
      }),
    ).toBe(true);
    expect(
      shouldTryFallbackModel({
        cancelled: false,
        yieldedTokens: true,
        fallbackModel: 'qwen-plus',
      }),
    ).toBe(false);
    expect(
      shouldTryFallbackModel({
        cancelled: true,
        yieldedTokens: false,
        fallbackModel: 'qwen-plus',
      }),
    ).toBe(false);
    expect(
      shouldTryFallbackModel({
        cancelled: false,
        yieldedTokens: false,
        fallbackModel: null,
      }),
    ).toBe(false);
  });

  it('getCsFallbackModel 与主模型相同或空则跳过', () => {
    process.env.CS_TEXT_MODEL = 'qwen-flash';
    process.env.CS_FALLBACK_MODEL = 'qwen-plus';
    expect(getCsFallbackModel()).toBe('qwen-plus');
    process.env.CS_FALLBACK_MODEL = 'qwen-flash';
    expect(getCsFallbackModel()).toBeNull();
    process.env.CS_FALLBACK_MODEL = '';
    expect(getCsFallbackModel()).toBeNull();
  });

  it('改写：主模型失败后打备用模型', async () => {
    const models: string[] = [];
    const completeFn = jest.fn(async (opts: { model: string }) => {
      models.push(opts.model);
      if (opts.model === 'qwen-flash') throw new LlmHttpError(503, 'busy');
      return '备用短答';
    });
    const text = await rewriteWithModelFallback({
      prepared,
      snippetFallback: '摘录兜底',
      primaryModel: 'qwen-flash',
      fallbackModel: 'qwen-plus',
      completeFn: completeFn as any,
      sleepFn: async () => undefined,
    });
    expect(text).toBe('备用短答');
    expect(models.includes('qwen-flash')).toBe(true);
    expect(models.includes('qwen-plus')).toBe(true);
  });

  it('流式：0 token 切备用；已有 chunk 不切', async () => {
    const models: string[] = [];
    const streamFn = jest.fn(async function* (
      _k: string,
      _b: string,
      _m: unknown,
      model: string,
    ) {
      models.push(model);
      if (model === 'qwen-flash') throw new LlmHttpError(503, 'busy');
      yield { type: 'chunk' as const, chunk: 'plus答' };
    });
    const got: string[] = [];
    for await (const item of streamWithModelFallback({
      messages: [{ role: 'user', content: 'q' }],
      primaryModel: 'qwen-flash',
      fallbackModel: 'qwen-plus',
      snippetFallback: '摘录兜底',
      streamFn: streamFn as any,
      sleepFn: async () => undefined,
    })) {
      if (item.type === 'chunk') got.push(item.chunk);
    }
    expect(got.join('')).toBe('plus答');
    expect(models.filter((m) => m === 'qwen-plus').length).toBeGreaterThan(0);

    models.length = 0;
    const streamFn2 = jest.fn(async function* (
      _k: string,
      _b: string,
      _m: unknown,
      model: string,
    ) {
      models.push(model);
      yield { type: 'chunk' as const, chunk: 'flash答' };
    });
    const got2: string[] = [];
    for await (const item of streamWithModelFallback({
      messages: [{ role: 'user', content: 'q' }],
      primaryModel: 'qwen-flash',
      fallbackModel: 'qwen-plus',
      snippetFallback: '摘录兜底',
      streamFn: streamFn2 as any,
      sleepFn: async () => undefined,
    })) {
      if (item.type === 'chunk') got2.push(item.chunk);
    }
    expect(got2.join('')).toBe('flash答');
    expect(models).toEqual(['qwen-flash']);
  });

  it('用户取消不切备用模型', async () => {
    const signal = AbortSignal.abort(USER_CANCEL_REASON);
    await expect(
      rewriteWithModelFallback({
        prepared,
        snippetFallback: '摘录兜底',
        primaryModel: 'qwen-flash',
        fallbackModel: 'qwen-plus',
        signal,
        completeFn: async () => 'x',
        sleepFn: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(UserCancelError);
  });
});
