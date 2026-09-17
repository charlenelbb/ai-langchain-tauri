export const CS_KB_ID = 'customer-service';

export function getCsTextModel(): string {
  return (process.env.CS_TEXT_MODEL || 'qwen-flash').trim() || 'qwen-flash';
}

/** LangChain pgvector cosine 返回距离：越小越相近。超过该阈值视为未命中。 */
export const CS_MAX_COSINE_DISTANCE = Number(
  process.env.CS_MAX_COSINE_DISTANCE ?? 0.55,
);

export const CS_INTENTS = ['presale', 'aftersale', 'complaint', 'other'] as const;
export type CsIntent = (typeof CS_INTENTS)[number];

export const TICKET_STATUSES = ['open', 'in_progress', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export type CsCitation = {
  source: string;
  chunkIndex: number;
  score: number;
  snippet: string;
};

export type CsPrepareResult = {
  intent: CsIntent;
  grounded: boolean;
  suggestTicket: boolean;
  wantHandoff?: boolean;
  citations: CsCitation[];
  refuseMessage?: string;
  historyContext: string;
  question: string;
  kbId: string;
};

export function isCsIntent(value: string): value is CsIntent {
  return (CS_INTENTS as readonly string[]).includes(value);
}

export function isTicketStatus(value: string): value is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(value);
}
