import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/button';

type ImageGenerateResponse =
  | {
      ok: true;
      images: Array<{ b64: string; mimeType: string }>;
      model: string;
      size: string;
      n: number;
    }
  | { ok: false; error: string };

type HistoryItem = {
  id: string;
  prompt: string;
  model: string;
  size: string;
  mimeType: string;
  imageData: string;
  createdAt: string;
};

function b64ToDataUrl(b64: string, mimeType: string) {
  return `data:${mimeType};base64,${b64}`;
}

const ImageGenModule: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('qwen-image-2.0');
  const [size, setSize] = useState('1024x1024');
  const [n, setN] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string>('');
  const [images, setImages] = useState<Array<{ url: string; mimeType: string }>>(
    []
  );
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(true);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('http://localhost:3000/image/history?limit=50');
      const data = (await res.json()) as HistoryItem[];
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

  const handleNewConversation = useCallback(() => {
    if (isGenerating) return;
    setPrompt('');
    setImages([]);
    setError('');
    setN(1);
    loadHistory();
  }, [isGenerating, loadHistory]);

  const canGenerate = useMemo(
    () => prompt.trim().length > 0 && !isGenerating,
    [prompt, isGenerating]
  );

  async function generate() {
    const p = prompt.trim();
    if (!p) {
      alert('请输入图片描述');
      return;
    }

    setIsGenerating(true);
    setError('');
    setImages([]);

    try {
      const res = await fetch('http://localhost:3000/image/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: p, model, size, n }),
      });
      const data = (await res.json()) as ImageGenerateResponse;
      if (!data.ok) {
        setError(data.error || '生成失败');
        return;
      }
      setImages(
        data.images.map((img) => ({
          url: b64ToDataUrl(img.b64, img.mimeType),
          mimeType: img.mimeType,
        }))
      );
      loadHistory();
    } catch (e) {
      setError('请求失败，请检查后端是否启动');
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="p-6">
      <div className="max-w-5xl">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 className="text-xl font-bold">文生图</h2>
          <Button
            onClick={handleNewConversation}
            disabled={isGenerating}
            className="bg-slate-200 hover:bg-slate-300 text-slate-800 px-4 py-2 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            新建对话
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="col-span-3">
            <label className="block text-sm text-gray-600 mb-1">图片描述</label>
            <textarea
              className="w-full border rounded px-3 py-2 min-h-[110px]"
              placeholder="例如：一只戴着宇航员头盔的橘猫，赛博朋克风，霓虹灯，超清细节"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isGenerating}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">模型</label>
            <input
              className="w-full border rounded px-2 py-1"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={isGenerating}
            />
            <div className="text-xs text-gray-500 mt-1">
              默认使用 OpenAI 图片模型（可改成你自己的）
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">尺寸</label>
            <select
              className="w-full border rounded px-2 py-1"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              disabled={isGenerating}
            >
              <option value="1024x1024">1024x1024</option>
              <option value="1536x1024">1536x1024</option>
              <option value="1024x1536">1024x1536</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">张数</label>
            <input
              type="number"
              min={1}
              max={4}
              className="w-full border rounded px-2 py-1"
              value={n}
              onChange={(e) => setN(parseInt(e.target.value || '1', 10))}
              disabled={isGenerating}
            />
          </div>
        </div>

        <Button
          onClick={generate}
          disabled={!canGenerate}
          className="bg-indigo-600 hover:bg-indigo-700"
        >
          {isGenerating ? '生成中...' : '生成图片'}
        </Button>

        {error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-4">
          {images.map((img, idx) => (
            <div key={idx} className="bg-white border rounded overflow-hidden">
              <img src={img.url} className="w-full h-auto block" />
              <div className="p-2 flex items-center justify-between text-xs text-gray-600">
                <span>{img.mimeType}</span>
                <a
                  href={img.url}
                  download={`generated_${idx + 1}.png`}
                  className="text-indigo-600 hover:underline"
                >
                  下载
                </a>
              </div>
            </div>
          ))}
        </div>

        {images.length === 0 && !error && (
          <div className="mt-6 text-sm text-gray-500">
            输入描述后点击“生成图片”，生成结果会在这里展示。
          </div>
        )}

        <div className="mt-8 border-t pt-6">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-2 text-lg font-bold text-gray-800 mb-3"
          >
            <span>{showHistory ? '▼' : '▶'}</span>
            历史记录
            {history.length > 0 && (
              <span className="text-sm font-normal text-gray-500">
                （共 {history.length} 条）
              </span>
            )}
          </button>
          {showHistory && (
            <>
              {historyLoading ? (
                <div className="text-sm text-gray-500">加载中...</div>
              ) : history.length === 0 ? (
                <div className="text-sm text-gray-500">
                  暂无历史，生成后的图片会出现在这里。
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {history.map((item) => (
                    <div
                      key={item.id}
                      className="bg-white border rounded overflow-hidden shadow-sm"
                    >
                      <img
                        src={b64ToDataUrl(item.imageData, item.mimeType)}
                        alt={item.prompt.slice(0, 30)}
                        className="w-full aspect-square object-cover block"
                      />
                      <div className="p-2 text-xs text-gray-600 truncate" title={item.prompt}>
                        {item.prompt || '（无描述）'}
                      </div>
                      <div className="px-2 pb-2 flex items-center justify-between text-xs text-gray-400">
                        <span>
                          {item.size} · {new Date(item.createdAt).toLocaleString()}
                        </span>
                        <a
                          href={b64ToDataUrl(item.imageData, item.mimeType)}
                          download={`history_${item.id}.png`}
                          className="text-indigo-600 hover:underline"
                        >
                          下载
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImageGenModule;

