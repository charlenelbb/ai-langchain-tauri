import {
  classifyIntentByRules,
  hasSnippetOverlap,
  isHandoffRequest,
  rewriteFromSnippets,
  shouldExtractiveAnswer,
} from './cs-policy';
import type { CsPrepareResult } from './cs.types';

describe('cs-policy', () => {
  it('规则意图：发货/价格/投诉', () => {
    expect(classifyIntentByRules('多久发货')).toBe('aftersale');
    expect(classifyIntentByRules('专业版多少钱')).toBe('presale');
    expect(classifyIntentByRules('你们态度太差了，我要投诉')).toBe('complaint');
    expect(classifyIntentByRules('今天天气怎么样')).toBe('other');
  });

  it('转人工请求识别为投诉/转接，不走摘录', () => {
    expect(isHandoffRequest('转人工')).toBe(true);
    expect(isHandoffRequest('我要找人工')).toBe(true);
    expect(isHandoffRequest('转接客服')).toBe(true);
    expect(isHandoffRequest('如何转接订单')).toBe(false);
    expect(isHandoffRequest('真人玩家')).toBe(false);
    expect(isHandoffRequest('多久发货')).toBe(false);
    expect(classifyIntentByRules('转人工')).toBe('complaint');
    expect(classifyIntentByRules('我要找人工')).toBe('complaint');
    expect(classifyIntentByRules('转接客服')).toBe('complaint');
  });

  it('摘录重叠：发货问题命中时效条款', () => {
    const citations = [
      {
        source: 'faq.md',
        chunkIndex: 1,
        score: 0.4,
        snippet: '普通商品：付款后1-3个工作日发货。',
      },
    ];
    expect(hasSnippetOverlap('多久发货', citations)).toBe(true);
    expect(hasSnippetOverlap('今天天气', citations)).toBe(false);
  });

  it('口语改写只保留相关短句', () => {
    const text = rewriteFromSnippets('多久发货', [
      {
        source: 'faq.md',
        chunkIndex: 0,
        score: 0.4,
        snippet: '转人工条件见下文。普通商品：付款后1-3个工作日发货。禁止编造物流时效。',
      },
    ]);
    expect(text).toContain('1-3个工作日');
    expect(text.length).toBeLessThan(200);
  });

  it('高置信且无历史才走摘录', () => {
    const base: CsPrepareResult = {
      intent: 'aftersale',
      grounded: true,
      suggestTicket: false,
      citations: [
        {
          source: 'faq.md',
          chunkIndex: 1,
          score: 0.4,
          snippet: '付款后1-3个工作日发货',
        },
      ],
      historyContext: '',
      question: '多久发货',
      kbId: 'customer-service',
    };
    expect(shouldExtractiveAnswer(base)).toBe(true);
    expect(shouldExtractiveAnswer({ ...base, historyContext: '用户：上次问过' })).toBe(
      false,
    );
    expect(shouldExtractiveAnswer({ ...base, intent: 'complaint' })).toBe(false);
    expect(shouldExtractiveAnswer({ ...base, grounded: false })).toBe(false);
    expect(shouldExtractiveAnswer({ ...base, wantHandoff: true })).toBe(false);
  });
});
