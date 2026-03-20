const DEFAULT_EMBEDDING_MODEL = 'text-embedding-v4';

type EmbeddingItem = {
  embedding?: number[];
};

type EmbeddingResponse = {
  data?: EmbeddingItem[];
  message?: string;
  code?: number | string;
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

class DashScopeTextEmbeddingsV4 {
  private readonly apiKey: string;
  private readonly compatibleBaseUrl: string;
  private readonly model: string;
  private readonly dimensions?: number;
  private readonly batchSize: number;

  constructor(options: DashScopeEmbeddingsOptions = {}) {
    const apiKey =
      options.apiKey ||
      process.env.DASHSCOPE_API_KEY ||
      process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        '未配置 DASHSCOPE_API_KEY（或 OPENAI_API_KEY）。请在 .env 中设置后重启。',
      );
    }
    this.apiKey = apiKey;
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

    if (!resp.ok) {
      throw new Error(
        json?.message ||
          `请求百炼 embeddings 失败: ${resp.status} ${resp.statusText}\n${raw?.slice(0, 300)}`,
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

