import React, { useState } from 'react';
import { Button } from '../ui/button';

const MedicalModule: React.FC = () => {
  const [medicalQuestion, setMedicalQuestion] = useState('');
  const [medicalFile, setMedicalFile] = useState<File | null>(null);
  const [medicalResult, setMedicalResult] = useState('');
  const [isMedicalLoading, setIsMedicalLoading] = useState(false);
  const [promptTemplate, setPromptTemplate] = useState('detailed');

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
      </div>
    </div>
  );
};

export default MedicalModule;