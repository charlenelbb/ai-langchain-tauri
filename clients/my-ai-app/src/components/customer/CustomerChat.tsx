import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Headphones, LogOut } from 'lucide-react';
import { connectResilientSse } from '../../lib/sseResilient';
import { API_BASE, authFetch, authHeaders, type AuthUser } from '../../lib/api';
import { Button } from '../ui/button';
import { Composer } from '../chat/Composer';
import { MessageList } from '../chat/MessageList';
import { SessionList } from '../chat/SessionList';
import { mapSessionMessages } from '../chat/format';
import { CS_KIND, CS_KB_ID, FAQ_CHIPS, type SessionItem, type SessionMessage } from '../chat/types';

const CustomerChat: React.FC<{ user: AuthUser; onLogout: () => void }> = ({
  user,
  onLogout,
}) => {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionMessages, setSessionMessages] = useState<SessionMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState<
    'idle' | 'retrieving' | 'thinking' | 'streaming' | 'done' | 'error'
  >('idle');
  const [liveAnswer, setLiveAnswer] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [intent, setIntent] = useState<string | null>(null);
  const [grounded, setGrounded] = useState<boolean | null>(null);
  const [suggestTicket, setSuggestTicket] = useState(false);
  const [renameDialog, setRenameDialog] = useState<{ id: string; title: string } | null>(
    null,
  );
  const [deleteDialogId, setDeleteDialogId] = useState<string | null>(null);

  const sseStopRef = useRef<(() => void) | null>(null);
  const sessionsReqRef = useRef(0);

  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const botPaused = Boolean(currentSession?.botPaused);
  const lastAssistantMeta = [...sessionMessages]
    .reverse()
    .find((m) => m.sender === 'assistant')?.metadata;
  const showHandoffHint =
    !botPaused &&
    (suggestTicket ||
      intent === 'complaint' ||
      grounded === false ||
      lastAssistantMeta?.suggestTicket === true);
  const hasAgentReply = sessionMessages.some((m) => m.sender === 'agent');

  useEffect(() => {
    return () => {
      sseStopRef.current?.();
      sseStopRef.current = null;
    };
  }, []);

  const loadSessions = useCallback(async () => {
    const req = ++sessionsReqRef.current;
    try {
      const res = await authFetch(`/sessions?kind=${encodeURIComponent(CS_KIND)}`);
      const data = await res.json();
      const list = Array.isArray(data) ? (data as SessionItem[]) : [];
      if (req !== sessionsReqRef.current) return list;
      setSessions(list);
      return list;
    } catch {
      if (req === sessionsReqRef.current) setSessions([]);
      return [];
    }
  }, []);

  const loadSessionMessages = useCallback(async (sessionId: string) => {
    try {
      const res = await authFetch(`/sessions/${sessionId}`);
      const data = await res.json();
      const msgs = Array.isArray(data?.messages) ? data.messages : [];
      setSessionMessages(mapSessionMessages(msgs));
      if (data?.intent) setIntent(data.intent);
      if (typeof data?.botPaused === 'boolean') {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, botPaused: data.botPaused } : s)),
        );
      }
    } catch {
      setSessionMessages([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await loadSessions();
      if (cancelled) return;
      if (list.length > 0) {
        setCurrentSessionId(list[0].id);
        setIntent(list[0].intent || null);
        return;
      }
      try {
        const res = await authFetch('/sessions', {
          method: 'POST',
          body: JSON.stringify({ title: '咨询', kind: CS_KIND }),
        });
        const s = await res.json();
        if (!cancelled && s?.id) {
          setCurrentSessionId(s.id);
          await loadSessions();
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSessions]);

  useEffect(() => {
    if (!currentSessionId) return;
    void loadSessionMessages(currentSessionId);
  }, [currentSessionId, loadSessionMessages]);

  useEffect(() => {
    if (!botPaused || !currentSessionId || isLoading) return;
    const timer = window.setInterval(() => {
      void loadSessionMessages(currentSessionId);
      void loadSessions();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [botPaused, currentSessionId, isLoading, loadSessionMessages, loadSessions]);

  const resetLive = () => {
    setLiveAnswer('');
    setErrorMessage('');
    setStreamingStatus('idle');
    setGrounded(null);
    setSuggestTicket(false);
  };

  const handleNewConversation = useCallback(async () => {
    if (isLoading) return;
    try {
      const res = await authFetch('/sessions', {
        method: 'POST',
        body: JSON.stringify({ title: '咨询', kind: CS_KIND }),
      });
      const s = await res.json();
      if (s?.id) {
        setCurrentSessionId(s.id);
        setSessionMessages([]);
        setIntent(null);
        await loadSessions();
      }
    } catch {
      // ignore
    }
    setQuestion('');
    resetLive();
  }, [isLoading, loadSessions]);

  const switchSession = (sessionId: string) => {
    if (isLoading) return;
    setCurrentSessionId(sessionId);
    const found = sessions.find((s) => s.id === sessionId);
    setIntent(found?.intent || null);
    setQuestion('');
    resetLive();
  };

  async function ensureSession(): Promise<string | null> {
    if (currentSessionId) return currentSessionId;
    try {
      const res = await authFetch('/sessions', {
        method: 'POST',
        body: JSON.stringify({ title: '咨询', kind: CS_KIND }),
      });
      const s = await res.json();
      if (s?.id) {
        setCurrentSessionId(s.id);
        setSessionMessages([]);
        return s.id as string;
      }
    } catch {
      // ignore
    }
    return null;
  }

  async function sendFollowUp(sessionId: string, raw: string) {
    const res = await authFetch(`/cs/sessions/${sessionId}/follow-up`, {
      method: 'POST',
      body: JSON.stringify({ text: raw }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStreamingStatus('error');
      setErrorMessage(data?.message || '留言失败');
      return;
    }
    await loadSessionMessages(sessionId);
    await loadSessions();
  }

  async function sendToBot(sessionId: string, raw: string) {
    setStreamingStatus('retrieving');
    sseStopRef.current?.();
    sseStopRef.current = null;

    const res = await authFetch('/cs/stream/start', {
      method: 'POST',
      body: JSON.stringify({ question: raw, sessionId, kbId: CS_KB_ID }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      setStreamingStatus('error');
      setErrorMessage(errBody?.message || '无法开启客服流');
      setIsLoading(false);
      return;
    }
    const body = (await res.json()) as { streamId?: string };
    if (!body.streamId) {
      setStreamingStatus('error');
      setErrorMessage('服务端未返回 streamId');
      setIsLoading(false);
      return;
    }

    sseStopRef.current = connectResilientSse({
      baseUrl: API_BASE,
      initialStreamId: body.streamId,
      maxRetries: 30,
      initialBackoffMs: 1000,
      maxBackoffMs: 30_000,
      getHeaders: () => authHeaders(),
      handlers: {
        onIntent: (next) => setIntent(next),
        onStatus: (payload) => {
          if (payload.phase === 'retrieving') setStreamingStatus('retrieving');
        },
        onCitations: (payload) => {
          setGrounded(payload.grounded ?? null);
          setSuggestTicket(Boolean(payload.suggestTicket));
        },
        onMessageChunk: (rawChunk) => {
          try {
            const data = JSON.parse(rawChunk) as { type?: string; chunk?: string };
            if (data.chunk == null || data.chunk === '') return;
            if (data.type === 'thinking') return;
            setStreamingStatus('streaming');
            setLiveAnswer((prev) => prev + (data.chunk ?? ''));
          } catch {
            /* ignore */
          }
        },
        onDone: (payload) => {
          setStreamingStatus('done');
          if (payload?.suggestTicket) setSuggestTicket(true);
          if (payload?.botPaused) {
            setSessions((prev) =>
              prev.map((s) => (s.id === sessionId ? { ...s, botPaused: true } : s)),
            );
          }
          void loadSessionMessages(sessionId);
          void loadSessions();
          setIsLoading(false);
        },
        onError: (msg) => {
          setStreamingStatus('error');
          setErrorMessage(msg);
          void loadSessionMessages(sessionId);
          setIsLoading(false);
        },
        onGiveUp: () => {
          setStreamingStatus('error');
          setErrorMessage('连接多次失败，已停止重试');
          setIsLoading(false);
        },
      },
    });
  }

  async function handleSubmit(preset?: string) {
    const raw = (preset ?? question).trim();
    if (!raw || isLoading) return;
    const sessionId = await ensureSession();
    if (!sessionId) return;

    setSessionMessages((prev) => [
      ...prev,
      { id: 'local_user_' + Date.now(), sender: 'user', text: raw },
    ]);
    setQuestion('');
    setIsLoading(true);
    setLiveAnswer('');
    setErrorMessage('');
    setSuggestTicket(false);

    try {
      if (botPaused) {
        await sendFollowUp(sessionId, raw);
        setIsLoading(false);
      } else {
        await sendToBot(sessionId, raw);
      }
    } catch (err) {
      setStreamingStatus('error');
      setErrorMessage(err instanceof Error ? err.message : '请求失败');
      setIsLoading(false);
    }
  }

  const commitRenameSession = async () => {
    if (!renameDialog || isLoading) return;
    const nextTitle = renameDialog.title.trim();
    if (!nextTitle) return;
    await authFetch(`/sessions/${renameDialog.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: nextTitle }),
    });
    await loadSessions();
    setRenameDialog(null);
  };

  const commitDeleteSession = async () => {
    if (!deleteDialogId || isLoading) return;
    const id = deleteDialogId;
    await authFetch(`/sessions/${id}`, { method: 'DELETE' });
    const list = await loadSessions();
    if (currentSessionId === id) {
      setCurrentSessionId(list[0]?.id ?? null);
      setSessionMessages([]);
    }
    setDeleteDialogId(null);
  };

  const statusText = botPaused
    ? hasAgentReply
      ? '坐席已接入'
      : '排队中，坐席接入后会在本对话回复'
    : '智能客服在线';

  return (
    <div className="flex h-screen flex-col bg-[#f3f5f8]">
      <header className="h-14 shrink-0 bg-white border-b border-slate-200 px-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900">在线咨询</div>
          <div className="text-xs text-slate-500 truncate">
            {user.username} · {statusText}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isLoading || botPaused || !currentSessionId}
            onClick={() => void handleSubmit('转人工')}
            className="border-violet-200 text-violet-700 hover:bg-violet-50"
          >
            <Headphones className="size-4" />
            转人工
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} className="text-slate-600">
            <LogOut className="size-4" />
            退出
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <SessionList
          sessions={sessions}
          currentId={currentSessionId}
          disabled={isLoading}
          onSelect={switchSession}
          onNew={() => void handleNewConversation()}
          onRename={(s) => setRenameDialog({ id: s.id, title: s.title })}
          onDelete={setDeleteDialogId}
        />

        <main className="flex-1 flex flex-col min-w-0">
          {botPaused ? (
            <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-violet-50 text-violet-800 text-sm border border-violet-100">
              已转接人工，坐席接入后会在本对话回复。你仍可以继续留言。
            </div>
          ) : showHandoffHint ? (
            <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-amber-50 text-amber-900 text-sm border border-amber-100 flex items-center justify-between gap-3">
              <span>需要人工协助？</span>
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white"
                disabled={isLoading}
                onClick={() => void handleSubmit('转人工')}
              >
                转人工
              </Button>
            </div>
          ) : null}

          <MessageList
            messages={sessionMessages}
            live={{
              status: streamingStatus,
              answer: liveAnswer,
              error: errorMessage,
            }}
            empty={
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="max-w-md text-center space-y-4">
                  <div className="text-lg font-semibold text-slate-800">你好，有什么可以帮你？</div>
                  <p className="text-sm text-slate-500">
                    售后、物流、发票等问题可以直接问，也可以点下面的常见问题。
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {FAQ_CHIPS.map((chip) => (
                      <button
                        key={chip.label}
                        type="button"
                        className="px-3 py-1.5 rounded-full border border-slate-200 bg-white text-sm text-slate-700 hover:border-blue-300 hover:text-blue-700"
                        onClick={() => void handleSubmit(chip.question)}
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            }
          />

          <Composer
            value={question}
            onChange={setQuestion}
            onSubmit={() => void handleSubmit()}
            placeholder={botPaused ? '给坐席留言…' : '描述你的问题，例如：7 天无理由怎么退货？'}
            disabled={isLoading}
            busyLabel="回复中…"
          />
        </main>
      </div>

      {renameDialog ? (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-[420px] p-4 shadow-lg">
            <h3 className="font-semibold text-slate-800 mb-3">重命名会话</h3>
            <input
              className="w-full px-3 py-2 border rounded text-sm"
              value={renameDialog.title}
              onChange={(e) => setRenameDialog({ ...renameDialog, title: e.target.value })}
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="secondary" onClick={() => setRenameDialog(null)}>
                取消
              </Button>
              <Button className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={commitRenameSession}>
                保存
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteDialogId ? (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-[420px] p-4 shadow-lg">
            <h3 className="font-semibold text-slate-800 mb-3">删除会话</h3>
            <p className="text-sm text-slate-600 mb-4">确认删除该会话？此操作不可恢复。</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteDialogId(null)}>
                取消
              </Button>
              <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={commitDeleteSession}>
                删除
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default CustomerChat;
