import React, { useMemo, useState } from 'react';
import { Button } from '../ui/button';
import { authFetch } from '../../lib/api';

type IngestResponse = {
  ok: boolean;
  kbId?: string;
  files?: Array<{ name: string; bytes: number }>;
  chunks?: number;
  tableName?: string;
  error?: string;
};

type SearchHit = {
  pageContent: string;
  metadata?: { source?: string; chunkIndex?: number };
  score?: number;
};

type SearchResponse = {
  ok: boolean;
  kbId?: string;
  query?: string;
  topK?: number;
  results?: SearchHit[];
  error?: string;
};

const RagModule: React.FC = () => {
  const [kbId, setKbId] = useState('customer-service');
  const [chunkSize, setChunkSize] = useState(400);
  const [chunkOverlap, setChunkOverlap] = useState(100);
  const [files, setFiles] = useState<FileList | null>(null);
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingest, setIngest] = useState<IngestResponse | null>(null);
  const [ingestError, setIngestError] = useState('');

  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(4);
  const [isSearching, setIsSearching] = useState(false);
  const [search, setSearch] = useState<SearchResponse | null>(null);
  const [searchError, setSearchError] = useState('');

  const totalBytes = useMemo(() => {
    if (!files) return 0;
    return Array.from(files).reduce((sum, f) => sum + (f.size || 0), 0);
  }, [files]);

  async function ingestFiles() {
    if (!files || files.length === 0) {
      setIngestError('请先选择要上传的文件');
      return;
    }
    setIsIngesting(true);
    setIngest(null);
    setIngestError('');

    const form = new FormData();
    Array.from(files).forEach((f) => form.append('files', f));
    form.append('kbId', kbId.trim() || 'default');
    form.append('chunkSize', String(chunkSize));
    form.append('chunkOverlap', String(chunkOverlap));

    try {
      const res = await authFetch('/rag/ingest', { method: 'POST', body: form });
      const data = (await res.json()) as IngestResponse;
      if (!res.ok || data.error) {
        setIngestError(data.error || '入库失败');
        return;
      }
      setIngest(data);
    } catch {
      setIngestError('入库请求失败');
    } finally {
      setIsIngesting(false);
    }
  }

  async function searchKb() {
    const q = query.trim();
    if (!q) {
      setSearchError('请输入检索问题');
      return;
    }
    setIsSearching(true);
    setSearch(null);
    setSearchError('');
    try {
      const res = await authFetch('/rag/search', {
        method: 'POST',
        body: JSON.stringify({
          kbId: kbId.trim() || 'default',
          query: q,
          topK,
        }),
      });
      const data = (await res.json()) as SearchResponse;
      if (!res.ok || data.error) {
        setSearchError(data.error || '检索失败');
        return;
      }
      setSearch(data);
    } catch {
      setSearchError('检索请求失败');
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="grid grid-cols-2 gap-6 max-w-6xl mx-auto">
        <section className="p-5 bg-white rounded-2xl border border-slate-200 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">知识库入库</h2>
            <p className="text-xs text-slate-500 mt-1">
              客服默认读取 <code className="px-1 bg-slate-100 rounded">customer-service</code>
              。支持 txt / md / json / csv / docx。按标题切块，规则变更后需重新上传覆盖。
            </p>
          </div>
          <label className="block text-sm text-slate-600">
            知识库 ID
            <input
              className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
              value={kbId}
              onChange={(e) => setKbId(e.target.value)}
              disabled={isIngesting || isSearching}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm text-slate-600">
              切块大小
              <input
                type="number"
                className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                value={chunkSize}
                onChange={(e) => setChunkSize(parseInt(e.target.value || '400', 10))}
                disabled={isIngesting}
              />
            </label>
            <label className="text-sm text-slate-600">
              重叠
              <input
                type="number"
                className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                value={chunkOverlap}
                onChange={(e) => setChunkOverlap(parseInt(e.target.value || '100', 10))}
                disabled={isIngesting}
              />
            </label>
          </div>
          <div>
            <input
              type="file"
              multiple
              accept=".txt,.md,.json,.csv,.xml,.docx,text/*,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setFiles(e.target.files)}
              disabled={isIngesting}
            />
            <div className="text-xs text-slate-500 mt-1">
              已选择 {files?.length || 0} 个文件
              {totalBytes ? ` · ${(totalBytes / 1024).toFixed(1)} KB` : ''}
            </div>
          </div>
          <Button
            onClick={() => void ingestFiles()}
            disabled={isIngesting}
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {isIngesting ? '入库中…' : '开始入库'}
          </Button>
          {ingestError ? <div className="text-sm text-red-600">{ingestError}</div> : null}
          {ingest?.ok ? (
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-sm text-emerald-900 space-y-1">
              <div>已写入 {ingest.chunks ?? 0} 个切片</div>
              <div className="text-xs">知识库 {ingest.kbId}</div>
              {(ingest.files || []).map((f) => (
                <div key={f.name} className="text-xs text-emerald-800">
                  {f.name}
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="p-5 bg-white rounded-2xl border border-slate-200 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">检索预览</h2>
            <p className="text-xs text-slate-500 mt-1">用真实问题验证 FAQ 是否能被召回。</p>
          </div>
          <input
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={isSearching}
            placeholder="例如：多久发货？"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void searchKb();
            }}
          />
          <div className="flex gap-3 items-end">
            <label className="text-sm text-slate-600 w-28">
              条数
              <input
                type="number"
                className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                value={topK}
                onChange={(e) => setTopK(parseInt(e.target.value || '4', 10))}
                disabled={isSearching}
              />
            </label>
            <Button
              onClick={() => void searchKb()}
              disabled={isSearching}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isSearching ? '检索中…' : '检索'}
            </Button>
          </div>
          {searchError ? <div className="text-sm text-red-600">{searchError}</div> : null}
          <div className="space-y-2 max-h-[28rem] overflow-y-auto">
            {(search?.results || []).length === 0 && search?.ok ? (
              <p className="text-sm text-slate-500">没有命中切片</p>
            ) : null}
            {(search?.results || []).map((hit, i) => (
              <article key={`${hit.metadata?.source}-${i}`} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs text-slate-500 flex justify-between gap-2">
                  <span>{hit.metadata?.source || '未知来源'}</span>
                  {typeof hit.score === 'number' ? (
                    <span>距离 {hit.score.toFixed(3)}</span>
                  ) : null}
                </div>
                <p className="text-sm text-slate-800 mt-1 line-clamp-5 whitespace-pre-wrap">
                  {hit.pageContent}
                </p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default RagModule;
