import { hashPassword, readBearer, signToken, verifyPassword, verifyToken } from './token';

describe('token', () => {
  const prev = process.env.AUTH_SECRET;

  beforeAll(() => {
    process.env.AUTH_SECRET = 'unit-test-secret';
  });

  afterAll(() => {
    if (prev === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = prev;
  });

  it('密码哈希可校验，错误密码失败', () => {
    const stored = hashPassword('demo123');
    expect(verifyPassword('demo123', stored)).toBe(true);
    expect(verifyPassword('wrong', stored)).toBe(false);
    expect(verifyPassword('demo123', 'not-a-hash')).toBe(false);
  });

  it('解析 Bearer', () => {
    expect(readBearer('Bearer abc.def')).toBe('abc.def');
    expect(readBearer('bearer xyz')).toBe('xyz');
    expect(readBearer(['Bearer tok'])).toBe('tok');
    expect(readBearer('Token abc')).toBeNull();
    expect(readBearer(undefined)).toBeNull();
  });

  it('签名与校验', () => {
    const token = signToken({ sub: 'u1', username: 'customer', role: 'customer' }, 60);
    const payload = verifyToken(token);
    expect(payload?.sub).toBe('u1');
    expect(payload?.username).toBe('customer');
    expect(payload?.role).toBe('customer');
  });

  it('篡改 token 失败', () => {
    const token = signToken({ sub: 'u1', username: 'customer', role: 'customer' }, 60);
    const [body, sig] = token.split('.');
    expect(verifyToken(`${body}.aaaa`)).toBeNull();
    expect(verifyToken(`${body.slice(0, -1)}x.${sig}`)).toBeNull();
    expect(verifyToken('not-a-token')).toBeNull();
  });

  it('过期 token 失败', () => {
    const token = signToken({ sub: 'u1', username: 'customer', role: 'customer' }, -10);
    expect(verifyToken(token)).toBeNull();
  });
});
