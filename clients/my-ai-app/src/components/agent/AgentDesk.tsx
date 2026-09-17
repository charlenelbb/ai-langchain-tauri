import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch, type AuthUser } from '../../lib/api';
import { Button } from '../ui/button';
import { Composer } from '../chat/Composer';
import { MessageList } from '../chat/MessageList';
import { formatClock, intentClass, intentLabel, mapSessionMessages, statusLabel, uniqueSources } from '../chat/format';
import type { SessionMessage, TicketItem } from '../chat/types';

type QueueTab = 'open' | 'mine' | 'all';

const AgentDesk: React.FC<{ user: AuthUser }> = ({ user }) => {
  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [queueTab, setQueueTab] = useState<QueueTab>('open');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [sessionMessages, setSessionMessages] = useState<SessionMessage[]>([]);
  const [agentDraft, setAgentDraft] = useState('');
  const [ticketNotes, setTicketNotes] = useState('');
  const [ticketBusy, setTicketBusy] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const loadTickets = useCallback(async () => {
    try {
      const res = await authFetch('/cs/tickets');
      const data = await res.json();
      setTickets(Array.isArray(data) ? data : []);
    } catch {
      setTickets([]);
    }
  }, []);

  const selectedTicket = tickets.find((t) => t.id === selectedTicketId) || null;

  const loadSessionMessages = useCallback(async (sessionId: string) => {
    try {
      const res = await authFetch(`/sessions/${sessionId}`);
      const data = await res.json();
      const msgs = Array.isArray(data?.messages) ? data.messages : [];
      setSessionMessages(mapSessionMessages(msgs));
    } catch {
      setSessionMessages([]);
    }
  }, []);

  useEffect(() => {
    void loadTickets();
    const timer = window.setInterval(() => void loadTickets(), 5000);
    return () => window.clearInterval(timer);
  }, [loadTickets]);

  useEffect(() => {
    if (!selectedTicket?.sessionId) {
      setSessionMessages([]);
      return;
    }
    void loadSessionMessages(selectedTicket.sessionId);
    const timer = window.setInterval(() => {
      if (selectedTicket.sessionId) void loadSessionMessages(selectedTicket.sessionId);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [selectedTicket?.sessionId, loadSessionMessages]);

  useEffect(() => {
    setTicketNotes(selectedTicket?.notes || '');
    setAgentDraft('');
    setErrorMessage('');
  }, [selectedTicketId]);

  const filtered = useMemo(() => {
    if (queueTab === 'open') return tickets.filter((t) => t.status === 'open');
    if (queueTab === 'mine') return tickets.filter((t) => t.assigneeId === user.id);
    return tickets;
  }, [tickets, queueTab, user.id]);

  const claimedByMe = selectedTicket?.assigneeId === user.id;
  const lastAssistant = [...sessionMessages].reverse().find((m) => m.sender === 'assistant');
  const evidence = uniqueSources(lastAssistant?.metadata?.citations);
  const evidenceSnippets = lastAssistant?.metadata?.citations || [];

  async function patchTicket(id: string, body: { status?: string; notes?: string }) {
    setTicketBusy(true);
    try {
      const res = await authFetch(`/cs/tickets/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      if (res.ok) await loadTickets();
    } finally {
      setTicketBusy(false);
    }
  }

  async function claimCurrent() {
    if (!selectedTicket) return;
    setTicketBusy(true);
    try {
      const res = await authFetch(`/cs/tickets/${selectedTicket.id}/claim`, { method: 'POST' });
      if (res.ok) {
        await loadTickets();
        setQueueTab('mine');
        if (selectedTicket.sessionId) await loadSessionMessages(selectedTicket.sessionId);
      }
    } finally {
      setTicketBusy(false);
    }
  }

  async function sendAgentReply() {
    if (!selectedTicket?.sessionId || !agentDraft.trim()) return;
    setTicketBusy(true);
    setErrorMessage('');
    try {
      const res = await authFetch(`/cs/sessions/${selectedTicket.sessionId}/agent-reply`, {
        method: 'POST',
        body: JSON.stringify({ text: agentDraft.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMessage(data?.message || '回复失败');
        return;
      }
      setAgentDraft('');
      await loadSessionMessages(selectedTicket.sessionId);
      await loadTickets();
    } finally {
      setTicketBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-72 shrink-0 bg-white border-r border-slate-200 flex flex-col">
        <div className="px-3 pt-3 pb-2 border-b border-slate-100">
          <div className="text-sm font-semibold text-slate-800 mb-2">工单队列</div>
          <div className="flex gap-1">
            {(
              [
                ['open', '待领取'],
                ['mine', '我的'],
                ['all', '全部'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setQueueTab(id)}
                className={`flex-1 text-xs py-1.5 rounded-lg border ${
                  queueTab === id
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {filtered.length === 0 ? (
            <p className="p-3 text-xs text-slate-500">该队列暂无工单</p>
          ) : (
            filtered.map((t) => {
              const active = selectedTicketId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedTicketId(t.id)}
                  className={`w-full text-left p-3 rounded-xl border ${
                    active ? 'border-blue-200 bg-blue-50' : 'border-slate-100 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-sm font-medium text-slate-800 truncate">{t.title}</div>
                  <div className="mt-1 text-[11px] text-slate-500 truncate">
                    {t.customerName || '客户'} · {formatClock(t.createdAt)}
                  </div>
                  <div className="flex gap-1 mt-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${intentClass(t.intent)}`}>
                      {intentLabel(t.intent)}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-slate-50 text-slate-600">
                      {statusLabel(t.status)}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-[#f3f5f8]">
        {!selectedTicket ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
            从左侧选择工单开始处理
          </div>
        ) : (
          <>
            <div className="px-4 py-2.5 bg-white border-b border-slate-100 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate">{selectedTicket.title}</div>
                <div className="text-xs text-slate-500">
                  {selectedTicket.customerName || '客户'} · {statusLabel(selectedTicket.status)}
                </div>
              </div>
              {!claimedByMe && selectedTicket.status !== 'closed' ? (
                <Button
                  size="sm"
                  className="bg-violet-600 hover:bg-violet-700 text-white"
                  disabled={ticketBusy}
                  onClick={() => void claimCurrent()}
                >
                  认领
                </Button>
              ) : null}
            </div>
            <MessageList
              messages={sessionMessages}
              live={
                errorMessage
                  ? { status: 'error', answer: '', error: errorMessage }
                  : undefined
              }
              empty={
                <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
                  {selectedTicket.sessionId ? '该会话还没有消息' : '该工单没有绑定会话'}
                </div>
              }
            />
            {claimedByMe && selectedTicket.sessionId && selectedTicket.status !== 'closed' ? (
              <Composer
                value={agentDraft}
                onChange={setAgentDraft}
                onSubmit={() => void sendAgentReply()}
                placeholder="对客回复，写入同一会话时间线"
                disabled={ticketBusy}
                submitLabel="回复"
                busyLabel="发送中…"
              />
            ) : (
              <div className="border-t bg-white px-4 py-3 text-xs text-slate-500">
                {selectedTicket.status === 'closed'
                  ? '工单已结案'
                  : claimedByMe
                    ? '该工单未绑定会话，无法回复'
                    : '认领后才能对客回复'}
              </div>
            )}
          </>
        )}
      </main>

      <aside className="w-80 shrink-0 bg-white border-l border-slate-200 flex flex-col min-w-0">
        {selectedTicket ? (
          <>
            <div className="p-4 border-b border-slate-100 space-y-3">
              <div>
                <div className="text-xs text-slate-500">客户</div>
                <div className="text-sm font-medium text-slate-800">
                  {selectedTicket.customerName || '未知客户'}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">状态</div>
                <select
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                  value={selectedTicket.status}
                  disabled={ticketBusy || !claimedByMe}
                  onChange={(e) => void patchTicket(selectedTicket.id, { status: e.target.value })}
                >
                  <option value="open">待领取</option>
                  <option value="in_progress">处理中</option>
                  <option value="closed">已结案</option>
                </select>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">分类</div>
                <span className={`text-xs px-2 py-0.5 rounded border ${intentClass(selectedTicket.intent)}`}>
                  {intentLabel(selectedTicket.intent)}
                </span>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">工单摘要</div>
                <div className="text-xs text-slate-600 whitespace-pre-wrap max-h-28 overflow-auto bg-slate-50 rounded-lg p-2">
                  {selectedTicket.description}
                </div>
              </div>
            </div>
            <div className="p-4 border-b border-slate-100 space-y-2">
              <div className="text-xs font-medium text-slate-700">内部备注</div>
              <textarea
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                rows={3}
                placeholder="仅坐席可见"
                value={ticketNotes}
                onChange={(e) => setTicketNotes(e.target.value)}
                disabled={!claimedByMe}
              />
              <Button
                className="w-full bg-slate-800 hover:bg-slate-900 text-white"
                disabled={ticketBusy || !claimedByMe}
                onClick={() => void patchTicket(selectedTicket.id, { notes: ticketNotes })}
              >
                保存备注
              </Button>
            </div>
            <div className="p-4 space-y-2">
              <button
                type="button"
                className="text-xs font-medium text-slate-700 flex items-center justify-between w-full"
                onClick={() => setShowEvidence((v) => !v)}
              >
                <span>检索依据</span>
                <span className="text-slate-400">{showEvidence ? '收起' : '展开'}</span>
              </button>
              {showEvidence ? (
                evidence.length === 0 ? (
                  <p className="text-xs text-slate-500">本轮对话没有引用知识库</p>
                ) : (
                  <div className="space-y-2">
                    {evidenceSnippets.map((c, i) => (
                      <div key={`${c.source}-${c.chunkIndex}-${i}`} className="text-xs bg-slate-50 rounded-lg p-2">
                        <div className="font-medium text-slate-700">{c.source}</div>
                        <div className="text-slate-500 mt-1 line-clamp-4">{c.snippet}</div>
                      </div>
                    ))}
                  </div>
                )
              ) : null}
            </div>
          </>
        ) : (
          <div className="p-6 text-sm text-slate-400">选择工单后查看详情</div>
        )}
      </aside>
    </div>
  );
};

export default AgentDesk;
