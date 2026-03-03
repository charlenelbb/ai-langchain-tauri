import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './App.css';
import { Button } from './components/ui/button';

function App() {
  const [greetMsg, setGreetMsg] = useState('');
  const [name, setName] = useState('');
  const [sseMessage, setSseMessage] = useState('');
  const [sseQuery, setSseQuery] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // 医疗问答状态
  const [medicalQuestion, setMedicalQuestion] = useState('');
  const [medicalFile, setMedicalFile] = useState<File | null>(null);
  const [medicalResult, setMedicalResult] = useState('');
  const [isMedicalLoading, setIsMedicalLoading] = useState(false);

  async function greet() {
    // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
    setGreetMsg(await invoke('greet', { name }));
  }

  async function handleSSE() {
    if (!sseQuery.trim()) {
      alert('请输入查询内容');
      return;
    }

    setIsStreaming(true);
    setSseMessage('');

    try {
      // 连接到 SSE 接口
      const eventSource = new EventSource(
        `http://localhost:3000/sse?query=${encodeURIComponent(sseQuery)}`
      );

      // 处理开启事件
      eventSource.addEventListener('open', () => {
        console.log('SSE 连接已建立');
      });

      // 处理消息事件
      eventSource.addEventListener('message', (event) => {
        setSseMessage((prev) => prev + event.data);
      });

      // 处理完成事件
      eventSource.addEventListener('done', () => {
        console.log('SSE 流已完成');
        eventSource.close();
        setIsStreaming(false);
      });

      // 处理错误事件
      eventSource.addEventListener('error', (event) => {
        console.error('SSE 错误:', event);
        setSseMessage((prev) => prev + '\n[错误] ' + (event as any).data);
        eventSource.close();
        setIsStreaming(false);
      });

      // 连接打开失败
      eventSource.onerror = () => {
        if (eventSource.readyState === EventSource.CLOSED) {
          eventSource.close();
          setIsStreaming(false);
        }
      };
    } catch (error) {
      console.error('SSE 错误:', error);
      setIsStreaming(false);
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
    form.append('question', medicalQuestion);
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

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold mb-2">常规问询</h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="输入名字"
          className="border px-2 py-1 mr-2 rounded"
        />
        <button
          type="submit"
          onClick={greet}
          className="text-white bg-blue-500 hover:bg-blue-700 font-bold py-2 px-4 rounded"
        >
          Greet
        </button>
        {greetMsg && <p className="mt-4 text-green-600">{greetMsg}</p>}
      </div>

      <div className="mb-6">
        <h2 className="text-xl font-bold mb-2">SSE 实时通信</h2>
        <input
          value={sseQuery}
          onChange={(e) => setSseQuery(e.target.value)}
          placeholder="输入查询内容"
          className="border px-2 py-1 mr-2 rounded w-full mb-2"
          disabled={isStreaming}
        />
        <Button
          onClick={handleSSE}
          disabled={isStreaming}
          className="bg-green-500 hover:bg-green-700 disabled:bg-gray-400"
        >
          {isStreaming ? '流式接收中...' : '开始 SSE 查询'}
        </Button>
        {sseMessage && (
          <div className="mt-4 p-4 bg-gray-100 rounded border border-gray-300 max-h-96 overflow-auto">
            <p className="whitespace-pre-wrap">{sseMessage}</p>
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
      </div>
    </div>
  );
}

export default App;
