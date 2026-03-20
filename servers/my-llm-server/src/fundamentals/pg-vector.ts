import { PoolConfig } from 'pg';
import {
  DistanceStrategy,
  PGVectorStore,
} from '@langchain/community/vectorstores/pgvector';
import { Document } from '@langchain/core/documents';
import { createDashScopeTextEmbeddingsV4 } from './dashscope-embeddings';

type PgVectorInitOptions = {
  tableName?: string;
};

const DEFAULT_TABLE_NAME = 'langchain_documents';

const createEmbeddings = () => createDashScopeTextEmbeddingsV4();

const getConnectionString = () => {
  // 优先使用专用向量库连接串，其次复用 Prisma 的 DATABASE_URL
  return (
    process.env.PGVECTOR_CONNECTION_STRING ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:password@localhost:5435/ai_langchain_db?schema=public'
  );
};

const initializeStore = async (opts?: PgVectorInitOptions) => {
  const embeddings = createEmbeddings();
  const tableName = opts?.tableName || DEFAULT_TABLE_NAME;

  const config = {
    postgresConnectionOptions: {
      connectionString: getConnectionString(),
    } as PoolConfig,
    tableName,
    columns: {
      idColumnName: 'id',
      vectorColumnName: 'vector',
      contentColumnName: 'content',
      metadataColumnName: 'metadata',
    },
    distanceStrategy: 'cosine' as DistanceStrategy,
  };

  return await PGVectorStore.initialize(embeddings, config);
};

export type PgVectorSearchResult = {
  pageContent: string;
  metadata: Record<string, any>;
  score: number;
};

export const ingestToPGVector = async (
  documents: Document[],
  opts?: { tableName?: string; ids?: string[] },
) => {
  const store = await initializeStore({ tableName: opts?.tableName });
  await store.addDocuments(documents, opts?.ids ? { ids: opts.ids } : undefined);
  return { inserted: documents.length, tableName: opts?.tableName || DEFAULT_TABLE_NAME };
};

export const searchPGVector = async (
  query: string,
  opts?: { tableName?: string; topK?: number; filter?: Record<string, any> },
): Promise<PgVectorSearchResult[]> => {
  const topK = opts?.topK ?? 4;
  const store = await initializeStore({ tableName: opts?.tableName });
  const vector = await store.embeddings.embedQuery(query);

  // PGVectorStore 支持 metadata filter（如果底层实现/版本支持），不支持时会被忽略
  const results = await (store as any).similaritySearchVectorWithScore(
    vector,
    topK,
    opts?.filter,
  );

  return (results || []).map((r: any) => ({
    pageContent: r[0]?.pageContent ?? '',
    metadata: r[0]?.metadata ?? {},
    score: r[1] ?? 0,
  }));
};

// 兼容旧入口：把它当作“向量检索”使用
export const invokePGVector = async (query: string) => {
  return await searchPGVector(query, { topK: 4 });
};
