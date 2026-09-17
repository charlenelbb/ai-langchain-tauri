import { INTENT_LABEL, STATUS_LABEL } from './types';

export function intentClass(intent?: string | null) {
  switch (intent) {
    case 'presale':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'aftersale':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'complaint':
      return 'bg-red-50 text-red-700 border-red-200';
    default:
      return 'bg-slate-50 text-slate-600 border-slate-200';
  }
}

export function intentLabel(intent?: string | null) {
  if (!intent) return '待识别';
  return INTENT_LABEL[intent] || intent;
}

export function statusLabel(status?: string | null) {
  if (!status) return '';
  return STATUS_LABEL[status] || status;
}

export function formatClock(ts?: number | string) {
  if (!ts) return '';
  const d = new Date(typeof ts === 'number' ? ts : Date.parse(ts));
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function uniqueSources(
  citations: Array<{ source: string }> | null | undefined,
): string[] {
  if (!citations?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of citations) {
    const name = (c.source || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function mapSessionMessages(raw: unknown[]): import('./types').SessionMessage[] {
  return (Array.isArray(raw) ? raw : []).map((m: any) => ({
    id: m.id || String(Math.random()),
    sender: m.sender || 'user',
    text: m.text || '',
    timestamp: m.timestamp,
    metadata: m.metadata || null,
  }));
}
