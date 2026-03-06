import React, { useState, useEffect, useRef } from 'react';
import { Button } from '../ui/button';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
}

interface Session {
  id: string;
  title: string;
  messages?: Message[];
  updatedAt: string;
}

const ChatModule: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingBotId, setStreamingBotId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showSessionList, setShowSessionList] = useState(false);

  const messagesBufferRef = useRef<Record<string, string>>({});

  // 加载会话列表
  useEffect(() => {
    fetchSessions();
  }, []);

  // 当会话切换时，加载消息
  useEffect(() => {
    if (currentSessionId) {
      loadSessionMessages(currentSessionId);
    } else {
      setMessages([]);
    }
  }, [currentSessionId]);

  async function fetchSessions() {
    try {
      const res = await fetch('http://localhost:3000/sessions');
      const data = await res.json();
      setSessions(data);
    } catch (e) {
      console.warn('fetch sessions failed', e);
    }
  }

  async function loadSessionMessages(sessionId: string) {
    try {
      const res = await fetch(`http://localhost:3000/sessions/${sessionId}`);
      const session = await res.json();
      setMessages(session.messages || []);
    } catch (e) {
      console.warn('load session messages failed', e);
      setMessages([]);
    }
  }

  async function createNewSession() {
    try {
      const res = await fetch('http://localhost:3000/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '新会话' }),
      });
      const newSession = await res.json();
      setSessions((prev) => [newSession, ...prev]);
      setCurrentSessionId(newSession.id);
      setMessages([]);
      setShowSessionList(false);
    } catch (e) {
      console.warn('create session failed', e);
    }
  }

  async function switchSession(sessionId: string) {
    setCurrentSessionId(sessionId);
    setShowSessionList(false);
  }

  async function updateSessionTitle(sessionId: string, newTitle: string) {
    try {
      await fetch(`http://localhost:3000/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s))
      );
    } catch (e) {
      console.warn('update session title failed', e);
    }
  }

  async function deleteSession(sessionId: string) {
    try {
      await fetch(`http://localhost:3000/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        setMessages([]);
      }
    } catch (e) {
      console.warn('delete session failed', e);
    }
  }

  async function handleSendChat() {
    const text = chatInput.trim();
    if (!text || isStreaming) return;

    const userMsg = {
      id: 'msg_' + Date.now(),
      sender: 'user' as const,
      text,
    };

    // 先在 UI 中添加用户消息
    setMessages((prev) => [...prev, userMsg]);
    setChatInput('');

    let sessionId = currentSessionId;

    // 持久化用户消息
    try {
      if (!sessionId) {
        const res = await fetch('http://localhost:3000/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: '会话' }),
        });
        const s = await res.json();
        sessionId = s.id;
        setCurrentSessionId(s.id);
        setSessions((prev) => [s, ...prev]);
      }
      if (sessionId) {
        await fetch(`http://localhost:3000/sessions/${sessionId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(userMsg),
        });
      }
    } catch (e) {
      console.warn('persist user message failed', e);
    }

    setIsStreaming(true);

    // 先在 UI 中添加一个空的 assistant 消息，用于填充流式内容
    const botId = 'bot_' + Date.now() + Math.random().toString(36).slice(2);
    setStreamingBotId(botId);
    setMessages((prev) => [
      ...prev,
      { id: botId, sender: 'assistant', text: '' },
    ]);
    messagesBufferRef.current[botId] = '';

    try {
      // 使用新的 SSE 端点，自动传入会话上下文（由后端处理）
      const endpoint = sessionId
        ? `http://localhost:3000/sse/${sessionId}?query=${encodeURIComponent(text)}`
        : `http://localhost:3000/sse?query=${encodeURIComponent(text)}`;

      const eventSource = new EventSource(endpoint);

      eventSource.addEventListener('open', () => {
        // no-op
      });

      eventSource.addEventListener('message', (event) => {
        const chunk = event.data;
        // append to UI
        setMessages((prev) =>
          prev.map((m) => (m.id === botId ? { ...m, text: m.text + chunk } : m))
        );
        // append to buffer for final save
        messagesBufferRef.current[botId] =
          (messagesBufferRef.current[botId] || '') + chunk;
      });

      eventSource.addEventListener('done', async () => {
        // 在完成时，将最终助手文本写入后端会话
        try {
          const finalText = messagesBufferRef.current[botId] || '';
          if (sessionId) {
            await fetch(
              `http://localhost:3000/sessions/${sessionId}/messages`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  id: 'msg_' + Date.now(),
                  sender: 'assistant',
                  text: finalText,
                }),
              }
            );
          }
        } catch (e) {
          console.warn('persist assistant message failed', e);
        }
        eventSource.close();
        // 清理 buffer
        delete messagesBufferRef.current[botId];
        setIsStreaming(false);
        setStreamingBotId(null);
      });

      eventSource.addEventListener('error', (event) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botId
              ? { ...m, text: m.text + '\n[错误] ' + (event as any).data }
              : m
          )
        );
        eventSource.close();
        setIsStreaming(false);
        setStreamingBotId(null);
      });

      eventSource.onerror = () => {
        if (eventSource.readyState === EventSource.CLOSED) {
          eventSource.close();
          setIsStreaming(false);
          setStreamingBotId(null);
        }
      };
    } catch (error) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botId ? { ...m, text: m.text + '\n[连接错误]' } : m
        )
      );
      setIsStreaming(false);
      setStreamingBotId(null);
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold mb-2">
          对话（支持上下文 + 流式回复）
        </h2>

        <div className="mb-2 p-3 bg-gray-50 rounded border border-gray-200 max-h-80 overflow-auto">
          {messages.length === 0 ? (
            <p className="text-sm text-gray-500">
              尚无消息，输入内容开始对话。
            </p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`mb-2 flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`${m.sender === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-900'} px-3 py-2 rounded-lg max-w-full`}
                  style={{ whiteSpace: 'pre-wrap' }}
                >
                  {m.text ||
                    (m.sender === 'assistant' &&
                    isStreaming &&
                    streamingBotId === m.id
                      ? '正在生成回答...'
                      : '')}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex gap-2">
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="说点什么...（回车发送）"
            className="border px-2 py-1 rounded flex-1"
            disabled={isStreaming}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendChat();
              }
            }}
          />
          <Button
            onClick={handleSendChat}
            disabled={isStreaming}
            className="bg-green-500 hover:bg-green-700"
          >
            {isStreaming ? '流式接收中...' : '发送'}
          </Button>
          <Button
            onClick={() => {
              setMessages([]);
              setChatInput('');
            }}
            className="bg-gray-300 hover:bg-gray-400"
          >
            清空
          </Button>
        </div>

        {/* 会话管理工具栏 */}
        <div className="mt-2 flex gap-2 flex-wrap items-center">
          <Button
            onClick={() => setShowSessionList(!showSessionList)}
            className="bg-indigo-500 hover:bg-indigo-700 text-sm"
          >
            会话列表 ({sessions.length})
          </Button>
          <Button
            onClick={createNewSession}
            className="bg-green-600 hover:bg-green-700 text-sm"
          >
            新建会话
          </Button>
          {currentSessionId && (
            <span className="text-sm text-gray-600">
              当前:{' '}
              {sessions.find((s) => s.id === currentSessionId)?.title || '未知'}
            </span>
          )}
        </div>

        {/* 会话列表弹窗 */}
        {showSessionList && (
          <div className="mt-3 p-3 bg-white rounded border border-gray-300 max-h-96 overflow-auto">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold">会话列表</h3>
              <button
                onClick={() => setShowSessionList(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            {sessions.length === 0 ? (
              <p className="text-sm text-gray-500">尚无会话</p>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className={`p-2 mb-1 rounded border ${
                    currentSessionId === s.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-100 bg-gray-50'
                  } cursor-pointer hover:bg-gray-100`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1" onClick={() => switchSession(s.id)}>
                      <p className="font-medium text-sm">{s.title}</p>
                      <p className="text-xs text-gray-500">
                        {s.messages?.length || 0} 条消息 ·{' '}
                        {new Date(s.updatedAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          const newTitle = prompt('新标题:', s.title);
                          if (newTitle && newTitle.trim()) {
                            updateSessionTitle(s.id, newTitle.trim());
                          }
                        }}
                        className="text-xs px-2 py-1 bg-yellow-300 hover:bg-yellow-400 rounded"
                      >
                        改名
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`确认删除会话 "${s.title}"?`))
                            deleteSession(s.id);
                        }}
                        className="text-xs px-2 py-1 bg-red-500 text-white hover:bg-red-600 rounded"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatModule;