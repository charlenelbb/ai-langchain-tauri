import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
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
        strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold text-slate-900">{children}</strong>,
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

type MedicalHistoryItem = {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
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
  const [history, setHistory] = useState<MedicalHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/medical/history?limit=50`);
      const data = (await res.json()) as MedicalHistoryItem[];
      setHistory(Array.isArray(data) ? data : []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  function optimizePrompt(question: string, template: string): string {
    const templates: Record<string, string> = {
      detailed: `请详细分析以下医疗问题并提供建议：\n问题：${question}\n请提供：1. 可能的原因 2. 建议措施 3. 何时就医`,
      concise: `医疗问题：${question}\n请简洁回答。`,
      diagnostic: `患者描述：${question}\n请从诊断角度分析，包括可能的疾病和检查建议。`,
    };
    return templates[template] || question;
  }

  async function handleMedicalSubmit() {
    if (!medicalQuestion.trim() || !medicalFile) {
      alert('请填写问题描述并上传一张图片');
      return;
    }
    setIsMedicalLoading(true);
    setMedicalResult('');
    setThinkingContent('');
    setDisplayedThinkingLen(0);
    setDisplayedResultLen(0);
    setErrorMessage('');
    setStreamingStatus('thinking');
    setShowThinking(true);

    const form = new FormData();
    form.append('question', optimizePrompt(medicalQuestion, promptTemplate));
    form.append('image', medicalFile);

    try {
      const res = await fetch(`${API_BASE}/medical/stream`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok || !res.body) {
        setStreamingStatus('error');
        setErrorMessage('请求失败或无响应体');
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const raw = line.slice(6).trim();
            if (raw === '') continue;
            try {
              const data = JSON.parse(raw);
              if (data.error) {
                setStreamingStatus('error');
                setErrorMessage(data.error);
                return;
              }
              if (data.chunk != null) {
                if (data.type === 'thinking') {
                  setStreamingStatus((s) => (s === 'thinking' ? s : 'streaming'));
                  setThinkingContent((prev) => prev + data.chunk);
                } else {
                  setStreamingStatus('streaming');
                  setMedicalResult((prev) => prev + data.chunk);
                }
              }
              if (data.done) {
                setStreamingStatus('done');
                loadHistory();
              }
            } catch {
              // ignore parse error
            }
          }
        }
      }
      setStreamingStatus((s) => (s === 'error' ? s : 'done'));
      loadHistory();
    } catch (err) {
      setStreamingStatus('error');
      setErrorMessage(err instanceof Error ? err.message : '请求失败');
    } finally {
      setIsMedicalLoading(false);
    }
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

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold text-slate-800 mb-6">
        医疗问答助手
      </h2>

      <div className="grid gap-6">
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              问题描述
            </label>
            <textarea
              value={medicalQuestion}
              onChange={(e) => setMedicalQuestion(e.target.value)}
              placeholder="描述症状或上传图像相关的问题…"
              rows={3}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
              disabled={isMedicalLoading}
            />
            <div className="mt-3 flex flex-wrap items-center gap-4">
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

          <div className="p-5 border-b border-slate-100">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              上传图像
            </label>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`
                border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
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
                <div className="flex flex-col items-center gap-2">
                  <span className="text-4xl">🖼️</span>
                  <p className="text-sm font-medium text-slate-700">
                    {medicalFile.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    点击或拖拽可更换图片
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-4xl">📷</span>
                  <p className="text-sm text-slate-600">
                    点击或拖拽图片到此处
                  </p>
                  <p className="text-xs text-slate-400">
                    支持 JPG、PNG 等常见格式
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="p-5 flex justify-end">
            <Button
              onClick={handleMedicalSubmit}
              disabled={isMedicalLoading || !medicalQuestion.trim() || !medicalFile}
              className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2.5 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isMedicalLoading ? '分析中…' : '开始分析'}
            </Button>
          </div>
        </section>

        {(thinkingContent || streamingStatus === 'thinking') && (
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setShowThinking((v) => !v)}
              className="w-full p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between text-left hover:bg-slate-100/80"
            >
              <h3 className="text-sm font-semibold text-slate-700">模型思考过程</h3>
              <span className="text-slate-500 text-xs">{showThinking ? '收起' : '展开'}</span>
            </button>
            {showThinking && (
              <div className="p-5 min-h-[80px] max-h-[320px] overflow-y-auto">
                {streamingStatus === 'thinking' && !thinkingContent && (
                  <div className="flex items-center gap-3 text-slate-600">
                    <span className="inline-block w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                    <span className="text-sm">正在分析图像与问题…</span>
                  </div>
                )}
                {thinkingContent ? (
                  <div className="text-slate-500 text-sm leading-relaxed">
                    <MarkdownContent
                      content={thinkingContent.slice(0, displayedThinkingLen)}
                      className="text-slate-500"
                    />
                    {displayedThinkingLen < thinkingContent.length && (
                      <span className="inline-block w-2 h-4 ml-0.5 bg-slate-400 animate-pulse align-middle" />
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </section>
        )}

        <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-sm font-semibold text-slate-700">分析结果</h3>
          </div>
          <div className="p-5 min-h-[200px]">
            {streamingStatus === 'thinking' && !thinkingContent && (
              <div className="flex items-center gap-3 text-slate-600">
                <span className="inline-block w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                <span className="text-sm">正在分析图像与问题…</span>
                <span className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              </div>
            )}
            {(streamingStatus === 'streaming' || streamingStatus === 'done') &&
              medicalResult && (
                <div className="text-slate-800 leading-relaxed">
                  <MarkdownContent
                    content={medicalResult.slice(0, displayedResultLen)}
                  />
                  {displayedResultLen < medicalResult.length && (
                    <span className="inline-block w-2 h-4 ml-0.5 bg-purple-500 animate-pulse align-middle" />
                  )}
                </div>
              )}
            {streamingStatus === 'error' && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                {errorMessage}
              </div>
            )}
            {streamingStatus === 'idle' && !medicalResult && !errorMessage && (
              <p className="text-slate-400 text-sm">
                填写问题并上传图片后，点击「开始分析」即可查看流式输出结果。
              </p>
            )}
          </div>
          <div className="px-5 pb-4 pt-2 border-t border-slate-100 bg-amber-50/80">
            <p className="text-xs text-amber-800">
              {DISCLAIMER}
            </p>
          </div>
        </section>

        <section className="border-t border-slate-200 pt-6">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-2 text-lg font-bold text-slate-800 mb-3 hover:text-purple-600"
          >
            <span className="text-slate-500">{showHistory ? '▼' : '▶'}</span>
            历史记录
            {history.length > 0 && (
              <span className="text-sm font-normal text-slate-500">
                （共 {history.length} 条）
              </span>
            )}
          </button>
          {showHistory && (
            <>
              {historyLoading ? (
                <p className="text-sm text-slate-500">加载中…</p>
              ) : history.length === 0 ? (
                <p className="text-sm text-slate-500">
                  暂无历史，提交后的问答会出现在这里。
                </p>
              ) : (
                <div className="space-y-3 max-h-[420px] overflow-auto pr-1">
                  {history.map((item) => (
                    <div
                      key={item.id}
                      className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm hover:border-purple-200"
                    >
                      <div className="text-xs text-slate-500 mb-1">
                        {new Date(item.createdAt).toLocaleString()}
                      </div>
                      <div className="text-sm font-medium text-slate-800 mb-1">
                        {item.question || '（无问题描述）'}
                      </div>
                      <div className="text-sm text-slate-700">
                        <MarkdownContent content={item.answer} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default MedicalModule;
