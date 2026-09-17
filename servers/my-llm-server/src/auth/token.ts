import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

type TokenPayload = {
  sub: string;
  username: string;
  role: string;
  exp: number;
};

function getSecret(): string {
  return (process.env.AUTH_SECRET || 'dev-only-change-me').trim() || 'dev-only-change-me';
}

function b64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.toString('base64url');
}

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const next = scryptSync(plain, salt, 32);
  const prev = Buffer.from(hash, 'hex');
  if (next.length !== prev.length) return false;
  return timingSafeEqual(next, prev);
}

export function signToken(payload: Omit<TokenPayload, 'exp'>, ttlSec = 60 * 60 * 12): string {
  const body: TokenPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec };
  const encoded = b64url(JSON.stringify(body));
  const sig = b64url(createHmac('sha256', getSecret()).update(encoded).digest());
  return `${encoded}.${sig}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expected = b64url(createHmac('sha256', getSecret()).update(encoded).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
    if (!payload?.sub || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readBearer(header?: string | string[]): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m?.[1]?.trim() || null;
}
