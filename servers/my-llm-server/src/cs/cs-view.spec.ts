import { canCustomerFollowUp, previewLastMessage } from './cs-view';

describe('cs-view', () => {
  it('会话预览截断并压空白', () => {
    expect(previewLastMessage('')).toBe('');
    expect(previewLastMessage('  你好 世界  ')).toBe('你好 世界');
    expect(previewLastMessage('a'.repeat(40))).toHaveLength(40);
    expect(previewLastMessage('a'.repeat(41))).toBe(`${'a'.repeat(40)}…`);
  });

  it('转人工后仅客户可 follow-up', () => {
    expect(canCustomerFollowUp('customer', true)).toBe(true);
    expect(canCustomerFollowUp('customer', false)).toBe(false);
    expect(canCustomerFollowUp('agent', true)).toBe(false);
  });
});
