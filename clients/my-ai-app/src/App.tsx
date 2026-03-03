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
