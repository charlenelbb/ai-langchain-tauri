import React, { useState } from 'react';
import { Button } from '../ui/button';

const LoraTrainingModule: React.FC = () => {
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

  return (
    <div className="p-6">
      <div className="mb-6">
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
};

export default LoraTrainingModule;