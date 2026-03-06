import { useState, useEffect, useRef } from 'react';
import './App.css';
import { Button } from './components/ui/button';

interface Session {
  id: string;
  title: string;
  messages: Array<{ id: string; sender: 'user' | 'assistant'; text: string }>;
  createdAt: number;
  updatedAt: number;
}

function App() {
  // 对话状态（替换原来的 SSE 单次查询）
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<
    Array<{ id: string; sender: 'user' | 'assistant'; text: string }>
  >([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingBotId, setStreamingBotId] = useState<string | null>(null);

  // 会话持久化状态
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showSessionList, setShowSessionList] = useState(false);

  const messagesBufferRef = useRef<Record<string, string>>({});

  // 医疗问答状态
  const [medicalQuestion, setMedicalQuestion] = useState('');
  const [medicalFile, setMedicalFile] = useState<File | null>(null);
  const [medicalResult, setMedicalResult] = useState('');
  const [isMedicalLoading, setIsMedicalLoading] = useState(false);
  const [promptTemplate, setPromptTemplate] = useState('detailed'); // 添加 prompt 模板选择
  // LoRA 训练 UI 状态
  const [trainFile, setTrainFile] = useState<File | null>(null);
  const [modelName, setModelName] = useState('gpt2');
  const [trainJobId, setTrainJobId] = useState<string | null>(null);
  const [trainLog, setTrainLog] = useState('');
  const [isTraining, setIsTraining] = useState(false);
  const [loraR, setLoraR] = useState(8);
  const [loraAlpha, setLoraAlpha] = useState(32);
  const [loraDropout, setLoraDropout] = useState(0.1);
  const [epochs, setEpochs] = useState(3);
  const [batchSize, setBatchSize] = useState(4);
  const [learningRate, setLearningRate] = useState(0.0002);

  // 初始化：从后端加载会话列表并恢复当前会话
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('http://localhost:3000/sessions');
        if (!res.ok) throw new Error('failed');
        const list = await res.json();
        if (Array.isArray(list) && list.length > 0) {
          setSessions(list);
          const first = list[0];
          setCurrentSessionId(first.id);
          // load full session
          const sRes = await fetch(
            `http://localhost:3000/sessions/${first.id}`
          );
          if (sRes.ok) {
            const s = await sRes.json();
            setMessages(s.messages || []);
          } else {
            setMessages(first.messages || []);
          }
        } else {
          // create a session if none
          const createRes = await fetch('http://localhost:3000/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: '会话 1' }),
          });
          const s = await createRes.json();
          setSessions([s]);
          setCurrentSessionId(s.id);
          setMessages([]);
        }
      } catch (err) {
        console.error(
          'Failed to load sessions from backend, falling back to empty',
          err
        );
        setSessions([]);
        setCurrentSessionId(null);
        setMessages([]);
      }
    })();
  }, []);

  // 当 messages 改变时，更新当前会话的本地状态（后端已持久化）
  useEffect(() => {
    if (!currentSessionId) return;
    setSessions((prev) =>
      prev.map((s) =>
        s.id === currentSessionId
          ? { ...s, messages, updatedAt: Date.now() }
          : s
      )
    );
  }, [messages, currentSessionId]);

  // 会话由后端持久化，前端保持会话列表状态

  // 创建新会话
  function createNewSession() {
    (async () => {
      try {
        const res = await fetch('http://localhost:3000/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: `会话 ${sessions.length + 1}` }),
        });
        const s = await res.json();
        setSessions((prev) => [s, ...prev]);
        setCurrentSessionId(s.id);
        setMessages([]);
      } catch (e) {
        console.error('create session failed', e);
      }
    })();
  }

  // 切换会话
  function switchSession(sessionId: string) {
    (async () => {
      try {
        const res = await fetch(`http://localhost:3000/sessions/${sessionId}`);
        if (!res.ok) throw new Error('not found');
        const s = await res.json();
        setCurrentSessionId(sessionId);
        setMessages(s.messages || []);
        setShowSessionList(false);
      } catch (e) {
        console.error('switch session failed', e);
      }
    })();
  }

  // 删除会话
  function deleteSession(sessionId: string) {
    (async () => {
      try {
        const res = await fetch(`http://localhost:3000/sessions/${sessionId}`, {
          method: 'DELETE',
        });
        const data = await res.json();
        if (data.ok) {
          const remaining = sessions.filter((s) => s.id !== sessionId);
          setSessions(remaining);
          if (currentSessionId === sessionId) {
            if (remaining.length > 0) {
              switchSession(remaining[0].id);
            } else {
              createNewSession();
            }
          }
        }
      } catch (e) {
        console.error('delete session failed', e);
      }
    })();
  }

  // 更新会话标题
  function updateSessionTitle(sessionId: string, newTitle: string) {
    (async () => {
      try {
        const res = await fetch(`http://localhost:3000/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle }),
        });
        const s = await res.json();
        setSessions((prev) => prev.map((p) => (p.id === sessionId ? s : p)));
      } catch (e) {
        console.error('update title failed', e);
      }
    })();
  }

  // 发送用户消息并通过 SSE 接收带上下文的流式回复
  async function handleSendChat() {
    const text = chatInput.trim();
    if (!text) return;

    // 构造 user 消息并加入历史
    const userMsg = {
      id: String(Date.now()) + Math.random().toString(36).slice(2),
      sender: 'user' as const,
      text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setChatInput('');

    // 确保当前会话存在（如不存在则在后端创建）并把用户消息持久化到后端
    let sessionId = currentSessionId;
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

  async function handleMedicalSubmit() {
    if (!medicalQuestion.trim() || !medicalFile) {
      alert('请提供问题内容并选择一张图片');
      return;
    }
    setIsMedicalLoading(true);
    setMedicalResult('');

    const form = new FormData();
    const optimizedQuestion = optimizePrompt(medicalQuestion, promptTemplate);
    form.append('question', optimizedQuestion);
    form.append('image', medicalFile);

    try {
      const res = await fetch('http://localhost:3000/medical', {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      setMedicalResult(data.answer || data.error || '无返回');
    } catch (err) {
      setMedicalResult('请求失败');
    }
    setIsMedicalLoading(false);
  }

  // 触发 LoRA 训练
  async function handleStartTraining() {
    if (!trainFile) {
      alert('请上传训练数据文件 (JSONL/CSV/text)');
      return;
    }
    setIsTraining(true);
    setTrainLog('');

    const form = new FormData();
    form.append('file', trainFile);
    form.append('model_name', modelName);
    form.append('lora_r', String(loraR));
    form.append('lora_alpha', String(loraAlpha));
    form.append('lora_dropout', String(loraDropout));
    form.append('num_train_epochs', String(epochs));
    form.append('per_device_train_batch_size', String(batchSize));
    form.append('learning_rate', String(learningRate));

    try {
      const res = await fetch('http://localhost:3000/lora/train', {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (data.jobId) {
        setTrainJobId(data.jobId);
        pollLog(data.jobId);
      } else {
        setTrainLog(JSON.stringify(data));
        setIsTraining(false);
      }
    } catch (err) {
      setTrainLog('触发训练失败');
      setIsTraining(false);
    }
  }

  // 轮询日志
  let poller: number | null = null;
  function pollLog(jobId: string) {
    if (poller) window.clearInterval(poller);
    poller = window.setInterval(async () => {
      try {
        const res = await fetch(
          `http://localhost:3000/lora/status?jobId=${jobId}`
        );
        const data = await res.json();
        setTrainLog(data.log || '');
        if (
          (data.log || '').includes('LoRA adapter saved') ||
          (data.log || '').includes('[DONE]')
        ) {
          setIsTraining(false);
          if (poller) window.clearInterval(poller);
        }
      } catch (err) {
        setTrainLog((prev) => prev + '\n轮询日志失败');
        setIsTraining(false);
        if (poller) window.clearInterval(poller);
      }
    }, 2000) as unknown as number;
  }

  function optimizePrompt(question: string, template: string): string {
    const templates: Record<string, string> = {
      detailed: `请详细分析以下医疗问题并提供建议：\n问题：${question}\n请提供：1. 可能的原因 2. 建议措施 3. 何时就医`,
      concise: `医疗问题：${question}\n请简洁回答。`,
      diagnostic: `患者描述：${question}\n请从诊断角度分析，包括可能的疾病和检查建议。`,
    };
    return templates[template] || question;
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

      <div className="mb-6">
        <h2 className="text-xl font-bold mb-2">医疗问答助手</h2>
        <input
          value={medicalQuestion}
          onChange={(e) => setMedicalQuestion(e.target.value)}
          placeholder="描述症状或问题"
          className="border px-2 py-1 mr-2 rounded w-full mb-2"
          disabled={isMedicalLoading}
        />
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            setMedicalFile(e.target.files ? e.target.files[0] : null);
          }}
          className="mb-2"
          disabled={isMedicalLoading}
        />
        <Button
          onClick={handleMedicalSubmit}
          disabled={isMedicalLoading}
          className="bg-purple-500 hover:bg-purple-700 disabled:bg-gray-400"
        >
          {isMedicalLoading ? '正在分析...' : '提交医疗问题'}
        </Button>
        {medicalResult && (
          <div className="mt-4 p-4 bg-gray-100 rounded border border-gray-300">
            <p className="whitespace-pre-wrap">{medicalResult}</p>
          </div>
        )}
        <div className="mb-2">
          <label className="block text-sm font-semibold mb-1">
            选择回答风格：
          </label>
          <select
            value={promptTemplate}
            onChange={(e) => setPromptTemplate(e.target.value)}
            className="border px-2 py-1 rounded mb-2"
            disabled={isMedicalLoading}
          >
            <option value="detailed">详细分析</option>
            <option value="concise">简洁回答</option>
            <option value="diagnostic">诊断导向</option>
          </select>
        </div>
        <div className="mt-4 p-4 bg-yellow-50 rounded border border-yellow-200">
          <h3 className="text-lg font-semibold mb-2">
            LoRA 训练（上传数据并触发）
          </h3>
          <div className="grid grid-cols-2 gap-4 mb-2">
            <div>
              <label className="block text-sm mb-1">模型名</label>
              <input
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                className="border px-2 py-1 rounded w-full"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">训练文件</label>
              <input
                type="file"
                onChange={(e) =>
                  setTrainFile(e.target.files ? e.target.files[0] : null)
                }
              />
            </div>
            <div>
              <label className="block text-sm mb-1">LoRA r</label>
              <input
                type="number"
                value={loraR}
                onChange={(e) => setLoraR(parseInt(e.target.value || '8'))}
                className="border px-2 py-1 rounded w-full"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">LoRA alpha</label>
              <input
                type="number"
                value={loraAlpha}
                onChange={(e) => setLoraAlpha(parseInt(e.target.value || '32'))}
                className="border px-2 py-1 rounded w-full"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Dropout</label>
              <input
                type="number"
                step="0.01"
                value={loraDropout}
                onChange={(e) =>
                  setLoraDropout(parseFloat(e.target.value || '0.1'))
                }
                className="border px-2 py-1 rounded w-full"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Epochs</label>
              <input
                type="number"
                value={epochs}
                onChange={(e) => setEpochs(parseInt(e.target.value || '3'))}
                className="border px-2 py-1 rounded w-full"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Batch Size</label>
              <input
                type="number"
                value={batchSize}
                onChange={(e) => setBatchSize(parseInt(e.target.value || '4'))}
                className="border px-2 py-1 rounded w-full"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Learning Rate</label>
              <input
                type="number"
                step="1e-6"
                value={learningRate}
                onChange={(e) =>
                  setLearningRate(parseFloat(e.target.value || '0.0002'))
                }
                className="border px-2 py-1 rounded w-full"
              />
            </div>
          </div>
          <Button
            onClick={handleStartTraining}
            disabled={isTraining}
            className="bg-indigo-500 hover:bg-indigo-700"
          >
            {isTraining ? '训练进行中...' : '开始训练'}
          </Button>
          {trainJobId && <p className="mt-2 text-sm">任务 ID: {trainJobId}</p>}
          <div className="mt-3">
            <label className="block text-sm font-medium mb-1">训练日志</label>
            <div className="p-2 bg-gray-900 text-white rounded max-h-64 overflow-auto whitespace-pre-wrap text-xs">
              {trainLog || '暂无日志'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
