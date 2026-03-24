import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { connectResilientSse } from '../../lib/sseResilient';
import { Button } from '../ui/button';

const DISCLAIMER =
  'AI 生成内容仅供参考，可能存在错误或遗漏，不构成任何医疗建议。如有不适请及时就医。';

const TYPEWRITER_CHARS_PER_TICK = 3;
const TYPEWRITER_TICK_MS = 16;

function MarkdownContent({
  content,
  className = 'text-slate-800',
}: {
  content: string;
  className?: string;
}) {
  return (
    <ReactMarkdown
      className={`medical-markdown leading-relaxed ${className}`}
      components={{
        p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0">{children}</p>,
        h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-xl font-bold mt-4 mb-2 first:mt-0">{children}</h1>,
        h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-lg font-bold mt-3 mb-1.5">{children}</h2>,
        h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-base font-semibold mt-2 mb-1">{children}</h3>,
        ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
        ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
        li: ({ children }: { children?: React.ReactNode }) => <li className="leading-relaxed">{children}</li>,
        strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold text-current">{children}</strong>,
        code: ({ children }: { children?: React.ReactNode }) => (
          <code className="px-1 py-0.5 rounded bg-slate-100 text-sm font-mono">{children}</code>
        ),
        pre: ({ children }: { children?: React.ReactNode }) => (
          <pre className="p-3 rounded-lg bg-slate-100 overflow-x-auto text-sm my-2">{children}</pre>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

type SessionMessage = {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp?: number;
};

type SessionItem = {
  id: string;
  title: string;
  messages?: SessionMessage[];
  createdAt?: number;
  updatedAt?: number;
  messageCount?: number;
};

const API_BASE = 'http://localhost:3000';

const MedicalModule: React.FC = () => {
  const [medicalQuestion, setMedicalQuestion] = useState('');
  const [medicalFile, setMedicalFile] = useState<File | null>(null);
  const [medicalResult, setMedicalResult] = useState('');
  const [thinkingContent, setThinkingContent] = useState('');
  const [streamingStatus, setStreamingStatus] = useState<
    'idle' | 'thinking' | 'streaming' | 'done' | 'error'
  >('idle');
  const [showThinking, setShowThinking] = useState(true);
  const [displayedThinkingLen, setDisplayedThinkingLen] = useState(0);
  const [displayedResultLen, setDisplayedResultLen] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [isMedicalLoading, setIsMedicalLoading] = useState(false);
  const [promptTemplate, setPromptTemplate] = useState('detailed');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const medicalSseStopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      medicalSseStopRef.current?.();
      medicalSseStopRef.current = null;
    };
  }, []);

  // 会话（多轮对话上下文）
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionMessages, setSessionMessages] = useState<SessionMessage[]>([]);
  const [renameDialog, setRenameDialog] = useState<
    { id: string; title: string } | null
  >(null);
  const [deleteDialogId, setDeleteDialogId] = useState<string | null>(null);

  // 打字机：将 displayed 长度逐步追上实际内容长度
  useEffect(() => {
    const tick = () => {
      setDisplayedThinkingLen((prev) => {
        const target = thinkingContent.length;
        if (prev >= target) return prev;
        return Math.min(prev + TYPEWRITER_CHARS_PER_TICK, target);
      });
      setDisplayedResultLen((prev) => {
        const target = medicalResult.length;
        if (prev >= target) return prev;
        return Math.min(prev + TYPEWRITER_CHARS_PER_TICK, target);
      });
    };
    const id = setInterval(tick, TYPEWRITER_TICK_MS);
    return () => clearInterval(id);
  }, [thinkingContent.length, medicalResult.length]);

  // 输出完毕后自动折叠推理区（ChatGPT 风格）
  useEffect(() => {
    if (streamingStatus === 'done') setShowThinking(false);
  }, [streamingStatus]);

  // 思考过程框：流式输出时自动滚动到底部
  const thinkingScrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollThinkingRef = useRef(true);
  const thinkingScrollRafRef = useRef<number | null>(null);
  const thinkingLastScrollAtRef = useRef(0);
  useEffect(() => {
    if (!showThinking) return;
    if (!isMedicalLoading) return;
    if (streamingStatus !== 'thinking' && streamingStatus !== 'streaming') return;
    const el = thinkingScrollRef.current;
    if (!el) return;
    if (!shouldAutoScrollThinkingRef.current) return;

    // 用 rAF 节流，避免打字机频繁更新导致滚动“抖动”
    const now = Date.now();
    if (now - thinkingLastScrollAtRef.current < 120) return;

    if (thinkingScrollRafRef.current != null) cancelAnimationFrame(thinkingScrollRafRef.current);
    thinkingScrollRafRef.current = requestAnimationFrame(() => {
      thinkingScrollRafRef.current = null;
      const current = thinkingScrollRef.current;
      if (!current) return;
      if (!shouldAutoScrollThinkingRef.current) return;
      current.scrollTop = current.scrollHeight;
      thinkingLastScrollAtRef.current = Date.now();
    });
  }, [showThinking, isMedicalLoading, streamingStatus, displayedThinkingLen]);

  // 组件卸载或停止自动滚动时清理 rAF
  useEffect(() => {
    return () => {
      if (thinkingScrollRafRef.current != null) {
        cancelAnimationFrame(thinkingScrollRafRef.current);
      }
    };
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/sessions`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setSessions(list);
      return list;
    } catch {
      setSessions([]);
      return [];
    }
  }, []);

  const loadSessionMessages = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}`);
      const data = await res.json();
      const msgs = Array.isArray(data?.messages) ? data.messages : [];
      setSessionMessages(
        msgs.map((m: any) => ({
          id: m.id || String(Math.random()),
          sender: m.sender || 'user',
          text: m.text || '',
          timestamp: m.timestamp,
        })),
      );
    } catch {
      setSessionMessages([]);
    }
  }, []);

  // 首次进入医疗模块：保证至少有一个会话可用
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await loadSessions();
        if (cancelled) return;
        if (list.length > 0) {
          setCurrentSessionId(list[0].id);
          return;
        }

        // 如果没有会话，创建一个
        const res = await fetch(`${API_BASE}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: '医疗会话' }),
        });
        const s = await res.json();
        if (!cancelled) setCurrentSessionId(s.id);
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
    loadSessionMessages(currentSessionId);
  }, [currentSessionId, loadSessionMessages]);

  const handleNewConversation = useCallback(async () => {
    if (isMedicalLoading) return;

    try {
      const res = await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '医疗会话' }),
      });
      const s = await res.json();
      if (s?.id) {
        setCurrentSessionId(s.id);
        setSessionMessages([]);
      }
    } catch {
      // ignore
    }

    setMedicalQuestion('');
    setMedicalFile(null);
    setMedicalResult('');
    setThinkingContent('');
    setDisplayedThinkingLen(0);
    setDisplayedResultLen(0);
    setErrorMessage('');
    setStreamingStatus('idle');
    setShowThinking(true);
    setDragOver(false);
  }, [isMedicalLoading]);

  const switchSession = useCallback(
    (sessionId: string) => {
      if (isMedicalLoading) return;
      setCurrentSessionId(sessionId);

      // 切换会话时清空当前输入/输出（对话内容来自左侧会话区）
      setMedicalQuestion('');
      setMedicalFile(null);
      setMedicalResult('');
      setThinkingContent('');
      setDisplayedThinkingLen(0);
      setDisplayedResultLen(0);
      setErrorMessage('');
      setStreamingStatus('idle');
      setShowThinking(true);
      setDragOver(false);
    },
    [isMedicalLoading],
  );

  const startRenameSession = useCallback(
    (id: string) => {
      if (isMedicalLoading) return;
      const oldTitle = sessions.find((s) => s.id === id)?.title || '';
      setRenameDialog({ id, title: oldTitle });
    },
    [isMedicalLoading, sessions],
  );

  const commitRenameSession = useCallback(async () => {
    if (!renameDialog) return;
    if (isMedicalLoading) return;
    const nextTitle = renameDialog.title.trim();
    if (!nextTitle) return;
    try {
      await fetch(`${API_BASE}/sessions/${renameDialog.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: nextTitle }),
      });
      await loadSessions();
      setRenameDialog(null);
    } catch {
      // ignore
    }
  }, [renameDialog, isMedicalLoading, loadSessions]);

  const startDeleteSession = useCallback(
    (id: string) => {
      if (isMedicalLoading) return;
      setDeleteDialogId(id);
    },
    [isMedicalLoading],
  );

  const commitDeleteSession = useCallback(async () => {
    if (!deleteDialogId) return;
    if (isMedicalLoading) return;
    const id = deleteDialogId;
    try {
      await fetch(`${API_BASE}/sessions/${id}`, { method: 'DELETE' });
      const list = await loadSessions();
      if (currentSessionId === id) {
        const nextId = list[0]?.id ?? null;
        setCurrentSessionId(nextId);
        setSessionMessages([]);
      }
      setDeleteDialogId(null);
    } catch {
      // ignore
    }
  }, [deleteDialogId, isMedicalLoading, loadSessions, currentSessionId]);

  function optimizePrompt(question: string, template: string): string {
    const templates: Record<string, string> = {
      detailed: `请详细分析以下医疗问题并提供建议：\n问题：${question}\n请提供：1. 可能的原因 2. 建议措施 3. 何时就医`,
      concise: `医疗问题：${question}\n请简洁回答。`,
      diagnostic: `患者描述：${question}\n请从诊断角度分析，包括可能的疾病和检查建议。`,
    };
    return templates[template] || question;
  }

  async function handleMedicalSubmit() {
    if (!medicalQuestion.trim()) {
      alert('请填写问题描述');
      return;
    }

    let sessionId = currentSessionId;
    if (!sessionId) {
      try {
        const res = await fetch(`${API_BASE}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: '医疗会话' }),
        });
        const s = await res.json();
        sessionId = s?.id;
        if (sessionId) {
          setCurrentSessionId(sessionId);
          setSessionMessages([]);
        }
      } catch {
        // ignore; will fallback to no session context
      }
    }

    const rawQuestion = medicalQuestion.trim();
    const modelQuestion = optimizePrompt(rawQuestion, promptTemplate);

    // 本地先把用户消息展示出来（后续会从后端刷新以确保一致）
    setSessionMessages((prev) => [
      ...prev,
      { id: 'local_user_' + Date.now(), sender: 'user', text: rawQuestion },
    ]);

    setIsMedicalLoading(true);
    setMedicalResult('');
    setThinkingContent('');
    setDisplayedThinkingLen(0);
    setDisplayedResultLen(0);
    setErrorMessage('');
    setStreamingStatus('thinking');
    setShowThinking(true);

    const form = new FormData();
    form.append('question', modelQuestion);
    form.append('rawQuestion', rawQuestion);
    if (sessionId) form.append('sessionId', sessionId);
    if (medicalFile) form.append('image', medicalFile);

    medicalSseStopRef.current?.();
    medicalSseStopRef.current = null;

    try {
      const res = await fetch(`${API_BASE}/medical/stream/start`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        setStreamingStatus('error');
        setErrorMessage('无法开启医疗流');
        setIsMedicalLoading(false);
        return;
      }
      const body = (await res.json()) as { streamId?: string };
      if (!body.streamId) {
        setStreamingStatus('error');
        setErrorMessage('服务端未返回 streamId');
        setIsMedicalLoading(false);
        return;
      }

      const sid = sessionId;
      medicalSseStopRef.current = connectResilientSse({
        baseUrl: API_BASE,
        initialStreamId: body.streamId,
        maxRetries: 30,
        initialBackoffMs: 1000,
        maxBackoffMs: 30_000,
        handlers: {
          onMessageChunk: (raw) => {
            try {
              const data = JSON.parse(raw) as {
                type?: string;
                chunk?: string;
              };
              if (data.chunk != null) {
                if (data.type === 'thinking') {
                  setStreamingStatus((s) =>
                    s === 'thinking' ? s : 'streaming',
                  );
                  setThinkingContent((prev) => prev + (data.chunk ?? ''));
                } else {
                  setStreamingStatus('streaming');
                  setMedicalResult((prev) => prev + (data.chunk ?? ''));
                }
              }
            } catch {
              /* ignore */
            }
          },
          onDone: () => {
            setStreamingStatus('done');
            if (sid) void loadSessionMessages(sid);
            setIsMedicalLoading(false);
          },
          onError: (msg) => {
            setStreamingStatus('error');
            setErrorMessage(msg);
            if (sid) void loadSessionMessages(sid);
            setIsMedicalLoading(false);
          },
          onGiveUp: () => {
            setStreamingStatus('error');
            setErrorMessage('连接多次失败，已停止重试');
            setIsMedicalLoading(false);
          },
        },
      });
    } catch (err) {
      setStreamingStatus('error');
      setErrorMessage(err instanceof Error ? err.message : '请求失败');
      setIsMedicalLoading(false);
    }

    // 允许后续多轮提问（不要求每次都上传图片）
    setMedicalQuestion('');
    setMedicalFile(null);
    setDragOver(false);
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f?.type.startsWith('image/')) setMedicalFile(f);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);

  const currentSessionTitle =
    sessions.find((s) => s.id === currentSessionId)?.title || '未命名';

  const isAssistantStreaming =
    isMedicalLoading && (streamingStatus === 'thinking' || streamingStatus === 'streaming');

  return (
    <div className="flex h-screen bg-gray-100">
      <aside className="w-80 bg-white border-r border-slate-200 flex flex-col min-w-0">
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-slate-800 truncate">历史对话</h2>
            <Button
              onClick={handleNewConversation}
              disabled={isMedicalLoading}
              className="bg-slate-200 hover:bg-slate-300 text-slate-800 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              新建
            </Button>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            当前：{currentSessionTitle}
          </div>
        </div>

        <div className="p-2 overflow-y-auto">
              {sessions.length === 0 ? (
                <p className="p-3 text-sm text-slate-500">暂无会话，点击「新建」开始。</p>
              ) : (
                <div className="space-y-2">
                  {sessions.map((s) => {
                    const count = s.messages?.length ?? s.messageCount ?? 0;
                    const isActive = currentSessionId === s.id;
                    return (
                      <div
                        key={s.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => switchSession(s.id)}
                        className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer ${
                          isActive
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        } ${isMedicalLoading ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div
                              className="text-sm font-medium text-slate-800 truncate cursor-text"
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                startRenameSession(s.id);
                              }}
                            >
                              {s.title}
                            </div>
                            <div className="text-xs text-slate-500 mt-1">
                              {count} 条
                            </div>
                          </div>
                          <button
                            type="button"
                            className="text-slate-500 hover:text-slate-800 text-sm leading-none px-1 py-0.5 rounded disabled:opacity-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              startDeleteSession(s.id);
                            }}
                            disabled={isMedicalLoading}
                            aria-label="删除会话"
                            title="删除会话"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
          {sessionMessages.length === 0 && !isMedicalLoading ? (
            <div className="text-sm text-slate-500">
              选择左侧会话或点击「新建」后，在底部输入问题（图片可选）。
            </div>
          ) : null}

          {sessionMessages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`px-3 py-2 rounded-lg max-w-[80%] text-sm leading-relaxed whitespace-pre-wrap ${
                  m.sender === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-slate-200 text-slate-900'
                }`}
              >
                {m.sender === 'assistant' ? (
                  <MarkdownContent
                    content={m.text}
                    className="text-slate-900"
                  />
                ) : (
                  m.text
                )}
              </div>
            </div>
          ))}

          {streamingStatus === 'error' && (
            <div className="flex justify-start">
              <div className="px-3 py-2 rounded-lg max-w-[80%] text-sm bg-red-50 border border-red-200 text-red-700 whitespace-pre-wrap">
                {errorMessage}
              </div>
            </div>
          )}

          {isAssistantStreaming && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 max-w-[80%] w-full">
                {(thinkingContent || streamingStatus === 'thinking') && (
                  <div className="mb-2">
                    <button
                      type="button"
                      onClick={() => setShowThinking((v) => !v)}
                      className="w-full flex items-center justify-between text-left text-xs text-slate-600 hover:text-slate-800 bg-slate-50 border border-slate-200 rounded px-2 py-1"
                    >
                      <span className="font-medium">模型思考过程</span>
                      <span>{showThinking ? '收起' : '展开'}</span>
                    </button>
                    {showThinking && (
                      <div className="mt-2 text-slate-500 text-sm leading-relaxed relative">
                        <div
                          ref={thinkingScrollRef}
                          className="max-h-[100px] overflow-y-auto pr-1 pt-1 pb-1"
                          onScroll={() => {
                            const el = thinkingScrollRef.current;
                            if (!el) return;
                            const distanceFromBottom =
                              el.scrollHeight - el.scrollTop - el.clientHeight;
                            // 用户离开底部就暂停自动滚动，避免滚动抖动干扰用户浏览
                            shouldAutoScrollThinkingRef.current = distanceFromBottom < 12;
                          }}
                        >
                          {streamingStatus === 'thinking' && !thinkingContent && (
                            <div className="flex items-center gap-2 text-slate-600">
                              <span className="inline-block w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                              <span>正在分析图像与问题…</span>
                            </div>
                          )}
                          {thinkingContent ? (
                            <>
                              <MarkdownContent
                                content={thinkingContent.slice(0, displayedThinkingLen)}
                                className="text-slate-500"
                              />
                              {displayedThinkingLen < thinkingContent.length && (
                                <span className="inline-block w-2 h-4 ml-0.5 bg-slate-400 animate-pulse align-middle" />
                              )}
                            </>
                          ) : null}
                        </div>
                        <div className="pointer-events-none absolute top-0 left-0 right-0 h-4 bg-gradient-to-b from-white/90 to-transparent" />
                        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-t from-white/90 to-transparent" />
                      </div>
                    )}
                  </div>
                )}

                {streamingStatus === 'streaming' && medicalResult && (
                  <div className="text-slate-800 leading-relaxed">
                    <MarkdownContent content={medicalResult.slice(0, displayedResultLen)} />
                    {displayedResultLen < medicalResult.length && (
                      <span className="inline-block w-2 h-4 ml-0.5 bg-purple-500 animate-pulse align-middle" />
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="border-t bg-white p-4">
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                问题描述
              </label>
              <textarea
                value={medicalQuestion}
                onChange={(e) => setMedicalQuestion(e.target.value)}
                placeholder="描述症状或上传图像相关的问题…（图片可选）"
                rows={3}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
                disabled={isMedicalLoading}
              />
            </div>
            <div className="flex items-center justify-between gap-4">

          <div className="flex items-center gap-4">
          <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                上传图像（可选）
              </label>
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className={`
                  border-2 border-dashed rounded-xl p-4 cursor-pointer transition-colors
                  ${dragOver ? 'border-purple-400 bg-purple-50' : 'border-slate-200 hover:border-purple-300 hover:bg-slate-50'}
                  ${isMedicalLoading ? 'pointer-events-none opacity-60' : ''}
                `}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setMedicalFile(e.target.files?.[0] ?? null)}
                  disabled={isMedicalLoading}
                />
                {medicalFile ? (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-2xl">🖼️</span>
                      <span className="text-sm text-slate-700 truncate">
                        {medicalFile.name}
                      </span>
                    </div>
                    <span className="text-xs text-slate-500">
                      点击或拖拽可更换
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 text-slate-600">
                    <span className="text-2xl">📷</span>
                    <div className="text-sm">
                      点击或拖拽图片到此处（可不传）
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  回答风格
                </label>
                <select
                  value={promptTemplate}
                  onChange={(e) => setPromptTemplate(e.target.value)}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                  disabled={isMedicalLoading}
                >
                  <option value="detailed">详细分析</option>
                  <option value="concise">简洁回答</option>
                  <option value="diagnostic">诊断导向</option>
                </select>
              </div>
            </div>

            </div>

            <div className="flex justify-end mr-10">
              <Button
                onClick={handleMedicalSubmit}
                disabled={isMedicalLoading || !medicalQuestion.trim()}
                className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2.5 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isMedicalLoading ? '分析中…' : '开始分析'}
              </Button>
            </div>
          </div>
            <div className="text-xs text-amber-800">
              {DISCLAIMER}
            </div>
          </div>
        </div>
      </main>

      {/* Rename modal */}
      {renameDialog && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-slate-200 w-[420px] p-4 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800">重命名会话</h3>
              <button
                type="button"
                className="text-slate-500 hover:text-slate-700"
                onClick={() => setRenameDialog(null)}
              >
                ✕
              </button>
            </div>
            <div className="text-sm text-slate-600 mb-2">
              {renameDialog.id}
            </div>
            <input
              className="w-full px-3 py-2 border rounded text-sm"
              value={renameDialog.title}
              onChange={(e) =>
                setRenameDialog({ ...renameDialog, title: e.target.value })
              }
              autoFocus
              disabled={isMedicalLoading}
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button
                onClick={() => setRenameDialog(null)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-800"
                disabled={isMedicalLoading}
              >
                取消
              </Button>
              <Button
                onClick={commitRenameSession}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
                disabled={isMedicalLoading}
              >
                保存
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteDialogId && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-slate-200 w-[420px] p-4 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800">删除会话</h3>
              <button
                type="button"
                className="text-slate-500 hover:text-slate-700"
                onClick={() => setDeleteDialogId(null)}
              >
                ✕
              </button>
            </div>
            <div className="text-sm text-slate-600 mb-4">
              确认删除该会话？此操作不可恢复。
            </div>
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => setDeleteDialogId(null)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-800"
                disabled={isMedicalLoading}
              >
                取消
              </Button>
              <Button
                onClick={commitDeleteSession}
                className="bg-red-600 hover:bg-red-700 text-white"
                disabled={isMedicalLoading}
              >
                删除
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MedicalModule;
