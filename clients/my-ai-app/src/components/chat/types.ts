import type { CsCitation } from '../../lib/sseResilient';

export type SessionMessage = {
  id: string;
  sender: 'user' | 'assistant' | 'agent';
  text: string;
  timestamp?: number;
  metadata?: {
    intent?: string;
    grounded?: boolean;
    suggestTicket?: boolean;
    citations?: CsCitation[];
    agentName?: string;
  } | null;
};

export type SessionItem = {
  id: string;
  title: string;
  intent?: string | null;
  messageCount?: number;
  botPaused?: boolean;
  lastMessage?: string | null;
  lastSender?: string | null;
  updatedAt?: number;
  userId?: string | null;
};

export type TicketItem = {
  id: string;
  title: string;
  description: string;
  intent: string;
  status: 'open' | 'in_progress' | 'closed' | string;
  sessionId?: string | null;
  assigneeId?: string | null;
  userId?: string | null;
  customerName?: string | null;
  assigneeName?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
};

export const CS_KIND = 'customer-service';
export const CS_KB_ID = 'customer-service';

export const INTENT_LABEL: Record<string, string> = {
  presale: '售前',
  aftersale: '售后',
  complaint: '投诉',
  other: '其他',
};

export const STATUS_LABEL: Record<string, string> = {
  open: '待领取',
  in_progress: '处理中',
  closed: '已结案',
};

export const FAQ_CHIPS = [
  { label: '怎么退货', question: '7 天无理由怎么退货？' },
  { label: '多久发货', question: '多久发货？' },
  { label: '怎么开发票', question: '怎么开发票？' },
];
