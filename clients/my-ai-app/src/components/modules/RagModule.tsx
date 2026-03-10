import React, { useMemo, useState } from 'react';
import { Button } from '../ui/button';

type IngestResponse = {
  ok: boolean;
  kbId?: string;
  files?: Array<{ name: string; bytes: number }>;
  chunks?: number;
  tableName?: string;
  error?: string;
};

type SearchResponse = {
  ok: boolean;
  kbId?: string;
  query?: string;
  topK?: number;
  results?: Array<{ pageContent: string; metadata: any; score: number }>;
  error?: string;
};

const RagModule: React.FC = () => {
  const [kbId, setKbId] = useState('default');
  const [chunkSize, setChunkSize] = useState(800);
  const [chunkOverlap, setChunkOverlap] = useState(100);
  const [files, setFiles] = useState<FileList | null>(null);
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<string>('');

  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(4);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<string>('');

  const totalBytes = useMemo(() => {
    if (!files) return 0;
    return Array.from(files).reduce((sum, f) => sum + (f.size || 0), 0);
  }, [files]);

  async function ingest() {
    if (!files || files.length === 0) {
      alert('请先选择要上传的文件（支持 txt/md/json/csv 等文本类）');
      return;
    }
    setIsIngesting(true);
    setIngestResult('');

    const form = new FormData();
    Array.from(files).forEach((f) => form.append('files', f));
    form.append('kbId', kbId.trim() || 'default');
    form.append('chunkSize', String(chunkSize));
    form.append('chunkOverlap', String(chunkOverlap));

    try {
      const res = await fetch('http://localhost:3000/rag/ingest', {
        method: 'POST',
        body: form,
      });
      const data = (await res.json()) as IngestResponse;
      setIngestResult(JSON.stringify(data, null, 2));
    } catch (e) {
      setIngestResult('入库请求失败');
    } finally {
      setIsIngesting(false);
    }
  }

  async function search() {
    const q = query.trim();
    if (!q) {
      alert('请输入检索 query');
      return;
    }
    setIsSearching(true);
    setSearchResult('');

    try {
      const res = await fetch('http://localhost:3000/rag/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kbId: kbId.trim() || 'default',
          query: q,
          topK,
        }),
      });
      const data = (await res.json()) as SearchResponse;
      setSearchResult(JSON.stringify(data, null, 2));
    } catch (e) {
      setSearchResult('检索请求失败');
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <div className="p-6">
      <div className="grid grid-cols-2 gap-6">
        <div className="p-4 bg-white rounded border">
          <h2 className="text-lg font-bold mb-3">知识库入库</h2>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">知识库 ID</label>
              <input
                className="w-full border rounded px-2 py-1"
                value={kbId}
                onChange={(e) => setKbId(e.target.value)}
                disabled={isIngesting || isSearching}
              />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">chunkSize</label>
              <input
                type="number"
                className="w-full border rounded px-2 py-1"
                value={chunkSize}
                onChange={(e) => setChunkSize(parseInt(e.target.value || '800', 10))}
                disabled={isIngesting}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">chunkOverlap</label>
              <input
                type="number"
                className="w-full border rounded px-2 py-1"
                value={chunkOverlap}
                onChange={(e) =>
                  setChunkOverlap(parseInt(e.target.value || '100', 10))
                }
                disabled={isIngesting}
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">选择文件</label>
              <input
                type="file"
                multiple
                onChange={(e) => setFiles(e.target.files)}
                disabled={isIngesting}
              />
              <div className="text-xs text-gray-500 mt-1">
                已选择 {files?.length || 0} 个文件 · {totalBytes} bytes
              </div>
            </div>
          </div>

          <Button
            onClick={ingest}
            disabled={isIngesting}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            {isIngesting ? '入库中...' : '开始入库（切片+向量化+写入向量库）'}
          </Button>

          <div className="mt-3">
            <label className="block text-sm font-medium mb-1">入库结果</label>
            <pre className="text-xs bg-gray-50 border rounded p-2 max-h-80 overflow-auto">
              {ingestResult || '等待入库...'}
            </pre>
          </div>
        </div>

        <div className="p-4 bg-white rounded border">
          <h2 className="text-lg font-bold mb-3">向量检索测试</h2>

          <div className="mb-3">
            <label className="block text-sm text-gray-600 mb-1">Query</label>
            <input
              className="w-full border rounded px-2 py-1"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={isSearching}
              placeholder="输入要检索的问题/关键词"
            />
          </div>

          <div className="flex gap-3 mb-3">
            <div className="w-40">
              <label className="block text-sm text-gray-600 mb-1">topK</label>
              <input
                type="number"
                className="w-full border rounded px-2 py-1"
                value={topK}
                onChange={(e) => setTopK(parseInt(e.target.value || '4', 10))}
                disabled={isSearching}
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={search}
                disabled={isSearching}
                className="bg-green-600 hover:bg-green-700"
              >
                {isSearching ? '检索中...' : '检索'}
              </Button>
            </div>
          </div>

          <div className="mt-3">
            <label className="block text-sm font-medium mb-1">检索结果</label>
            <pre className="text-xs bg-gray-50 border rounded p-2 max-h-80 overflow-auto">
              {searchResult || '等待检索...'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RagModule;

