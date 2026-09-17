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

function quoteIdent(tableName: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    throw new Error(`非法表名: ${tableName}`);
  }
  return `"${tableName}"`;
}

/** 按知识库 + 来源文件名删除旧块，便于同一文件重新入库覆盖乱码/旧切片 */
export const deleteFromPGVectorBySource = async (
  kbId: string,
  sources: string[],
  opts?: { tableName?: string },
) => {
  const tableName = quoteIdent(opts?.tableName || DEFAULT_TABLE_NAME);
  const uniqueSources = [...new Set(sources.map((s) => s.trim()).filter(Boolean))];
  if (!kbId.trim() || uniqueSources.length === 0) {
    return { deleted: 0, tableName: opts?.tableName || DEFAULT_TABLE_NAME };
  }

  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: getConnectionString() });
  try {
    const result = await pool.query(
      `DELETE FROM ${tableName}
       WHERE metadata->>'kbId' = $1
         AND metadata->>'source' = ANY($2::text[])`,
      [kbId, uniqueSources],
    );
    return {
      deleted: result.rowCount ?? 0,
      tableName: opts?.tableName || DEFAULT_TABLE_NAME,
    };
  } finally {
    await pool.end();
  }
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
  const kbId = String(opts?.filter?.kbId || '').trim();
  const tableName = quoteIdent(opts?.tableName || DEFAULT_TABLE_NAME);
  const store = await initializeStore({ tableName: opts?.tableName });
  const vector = await store.embeddings.embedQuery(query);
  const vecLiteral = `[${vector.join(',')}]`;

  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: getConnectionString() });
  try {
    const vectorRows = await pool.query(
      `SELECT content, metadata, (vector <=> $1::vector) AS dist
       FROM ${tableName}
       WHERE ($2::text IS NULL OR $2 = '' OR metadata->>'kbId' = $2)
       ORDER BY dist ASC
       LIMIT $3`,
      [vecLiteral, kbId || null, Math.max(topK * 3, topK)],
    );

    const terms = query
      .replace(/[？?，,。！!、；;：:\s]+/g, ' ')
      .split(' ')
      .map((s) => s.trim())
      .filter((s) => s.length >= 2)
      .slice(0, 5);

    let keywordRows: { content: string; metadata: any; dist: number }[] = [];
    if (terms.length) {
      const likes = terms.map((t) => `%${t.replace(/[%_]/g, '')}%`);
      const whereLike = likes.map((_, i) => `content ILIKE $${i + 2}`).join(' OR ');
      const kw = await pool.query(
        `SELECT content, metadata, 0.42::float AS dist
         FROM ${tableName}
         WHERE ($1::text IS NULL OR $1 = '' OR metadata->>'kbId' = $1)
           AND (${whereLike})
         LIMIT 12`,
        [kbId || null, ...likes],
      );
      keywordRows = kw.rows.map((r) => ({
        content: r.content,
        metadata: r.metadata,
        dist: Number(r.dist),
      }));
    }

    const merged = new Map<
      string,
      { pageContent: string; metadata: Record<string, any>; score: number; kw: boolean }
    >();
    const push = (content: string, metadata: any, dist: number, kw: boolean) => {
      const meta = metadata && typeof metadata === 'object' ? metadata : {};
      const key = `${meta.source || ''}#${meta.chunkIndex ?? content.slice(0, 24)}`;
      const score = Number(dist);
      const prev = merged.get(key);
      if (!prev || score < prev.score) {
        merged.set(key, {
          pageContent: content,
          metadata: meta,
          score,
          kw: Boolean(prev?.kw || kw),
        });
      } else if (kw) {
        prev.kw = true;
      }
    };
    for (const r of vectorRows.rows) {
      push(r.content, r.metadata, Number(r.dist), false);
    }
    for (const r of keywordRows) {
      push(r.content, r.metadata, r.dist, true);
    }

    return [...merged.values()]
      .map((r) => ({
        pageContent: r.pageContent,
        metadata: r.metadata,
        score: r.kw ? Math.max(0, r.score - 0.04) : r.score,
      }))
      .sort((a, b) => a.score - b.score)
      .slice(0, topK);
  } finally {
    await pool.end();
  }
};

// 兼容旧入口：把它当作“向量检索”使用
export const invokePGVector = async (query: string) => {
  return await searchPGVector(query, { topK: 4 });
};
