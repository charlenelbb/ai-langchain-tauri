import { parseCorsOrigin } from './cors-origin';

describe('parseCorsOrigin', () => {
  it('未设置或空白时保持全开放', () => {
    expect(parseCorsOrigin(undefined)).toBe(true);
    expect(parseCorsOrigin('')).toBe(true);
    expect(parseCorsOrigin('   ')).toBe(true);
    expect(parseCorsOrigin(', ,')).toBe(true);
  });

  it('单个来源去掉首尾空白', () => {
    expect(parseCorsOrigin(' https://app.example.com ')).toEqual(['https://app.example.com']);
  });

  it('逗号分隔多个来源并忽略空段', () => {
    expect(parseCorsOrigin('https://app.example.com, https://admin.example.com,')).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ]);
  });
});
