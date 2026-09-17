const windows = new Map<string, number[]>();

export function assertRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const prev = (windows.get(key) || []).filter((t) => now - t < windowMs);
  if (prev.length >= max) {
    windows.set(key, prev);
    return false;
  }
  prev.push(now);
  windows.set(key, prev);
  return true;
}

export function resetRateLimitForTests(): void {
  windows.clear();
}
