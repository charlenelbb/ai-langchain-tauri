import { assertRateLimit, resetRateLimitForTests } from './rate-limit';

describe('rate-limit', () => {
  beforeEach(() => {
    resetRateLimitForTests();
  });

  it('同 key 未超限为 true，达到上限后为 false', () => {
    const key = 'stream:user-a';
    expect(assertRateLimit(key, 2, 60_000)).toBe(true);
    expect(assertRateLimit(key, 2, 60_000)).toBe(true);
    expect(assertRateLimit(key, 2, 60_000)).toBe(false);
  });

  it('不同 key 互不影响', () => {
    expect(assertRateLimit('a', 1, 60_000)).toBe(true);
    expect(assertRateLimit('b', 1, 60_000)).toBe(true);
    expect(assertRateLimit('a', 1, 60_000)).toBe(false);
  });
});
