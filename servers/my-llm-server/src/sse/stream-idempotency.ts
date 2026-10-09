export type IdempotentStreamEntry = {
  streamId: string;
  expiresAt: number;
};

export class StreamIdempotencyStore {
  private readonly entries = new Map<string, IdempotentStreamEntry>();

  constructor(private readonly ttlMs = 2 * 60 * 1000) {}

  private key(userId: string, idempotencyKey: string): string {
    return `${userId}:${idempotencyKey}`;
  }

  get(userId: string, idempotencyKey: string): string | undefined {
    const key = this.key(userId, idempotencyKey);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.streamId;
  }

  set(userId: string, idempotencyKey: string, streamId: string): void {
    this.entries.set(this.key(userId, idempotencyKey), {
      streamId,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  reset(): void {
    this.entries.clear();
  }
}
