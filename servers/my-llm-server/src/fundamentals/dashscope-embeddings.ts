const DEFAULT_EMBEDDING_MODEL = 'text-embedding-v4';

const API_KEY_HINT =
  '请到 https://bailian.console.aliyun.com/?tab=model#/api-key 复制以 sk- 开头的密钥，写入 servers/my-llm-server/.env 的 DASHSCOPE_API_KEY，然后重启后端（改 .env 不会热更新）。';

type EmbeddingItem = {
  embedding?: number[];
};

type EmbeddingResponse = {
  data?: EmbeddingItem[];
  message?: string;
  code?: number | string;
  error?: { message?: string; code?: string };
};

export type DashScopeEmbeddingsOptions = {
  apiKey?: string;
  /**
   * 百炼 OpenAI-compatible base URL
   * e.g. https://dashscope.aliyuncs.com/compatible-mode/v1
   */
  compatibleBaseUrl?: string;
  model?: string;
  /**
   * 维度（可选，建议与数据库向量维度一致）
   * text-embedding-v4 支持 1024/1536 等；这里默认 1024
   */
  dimensions?: number;
  /**
   * 单次最多 embedding 行数，文本接口通常建议 <= 10
   */
  batchSize?: number;
};

function resolveApiKey(options: DashScopeEmbeddingsOptions): string {
  const apiKey = (
    options.apiKey ||
    process.env.DASHSCOPE_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ''
  ).trim();
  if (!apiKey) {
    throw new Error(`未配置 DASHSCOPE_API_KEY。${API_KEY_HINT}`);
  }
  if (!apiKey.startsWith('sk-')) {
    throw new Error(
      `DASHSCOPE_API_KEY 格式无效（百炼密钥应以 sk- 开头）。${API_KEY_HINT}`,
    );
  }
  return apiKey;
}

function isInvalidApiKeyError(
  status: number,
  json: EmbeddingResponse | undefined,
): boolean {
  if (status === 401) return true;
  const code = json?.error?.code || json?.code;
  return String(code || '').toLowerCase() === 'invalid_api_key';
}

class DashScopeTextEmbeddingsV4 {
  private readonly apiKey: string;
  private readonly compatibleBaseUrl: string;
  private readonly model: string;
  private readonly dimensions?: number;
  private readonly batchSize: number;

  constructor(options: DashScopeEmbeddingsOptions = {}) {
    this.apiKey = resolveApiKey(options);
    this.compatibleBaseUrl =
      options.compatibleBaseUrl ||
      process.env.DASHSCOPE_EMBEDDING_BASE_URL ||
      'https://dashscope.aliyuncs.com/compatible-mode/v1';
    this.model = options.model || process.env.DASHSCOPE_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
    this.dimensions = options.dimensions ?? Number(process.env.DASHSCOPE_EMBEDDING_DIMENSIONS || 1024);
    this.batchSize = options.batchSize ?? Number(process.env.DASHSCOPE_EMBEDDING_BATCH_SIZE || 10);
    if (!Number.isFinite(this.batchSize) || this.batchSize <= 0) {
      this.batchSize = 10;
    }
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const url = `${this.compatibleBaseUrl}/embeddings`;
    const body: Record<string, unknown> = {
      model: this.model,
      input: texts,
    };
    if (this.dimensions) body.dimensions = this.dimensions;

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const raw = await resp.text();
    let json: EmbeddingResponse | undefined;
    if (raw?.trim()) {
      try {
        json = JSON.parse(raw) as EmbeddingResponse;
      } catch {
        json = undefined;
      }
    }

    if (isInvalidApiKeyError(resp.status, json)) {
      throw new Error(`百炼 embeddings 鉴权失败（401 invalid_api_key）。${API_KEY_HINT}`);
    }

    if (!resp.ok) {
      const msg = json?.error?.message || json?.message;
      throw new Error(
        msg || `请求百炼 embeddings 失败: ${resp.status} ${resp.statusText}`,
      );
    }
    if (json?.code) {
      throw new Error(
        typeof json.code === 'string' ? json.code : String(json.code),
      );
    }

    const data = json?.data || [];
    return data.map((item) => item.embedding || []).map((v) => v as number[]);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (!Array.isArray(texts) || texts.length === 0) return [];

    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const vectors = await this.embedBatch(batch);
      out.push(...vectors);
    }
    return out;
  }

  async embedQuery(text: string): Promise<number[]> {
    const vectors = await this.embedDocuments([text]);
    return vectors[0] || [];
  }
}

export const createDashScopeTextEmbeddingsV4 = () =>
  new DashScopeTextEmbeddingsV4();
