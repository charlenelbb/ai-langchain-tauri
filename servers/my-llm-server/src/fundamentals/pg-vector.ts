import { PoolConfig } from 'pg';
import {
  DistanceStrategy,
  PGVectorStore,
} from '@langchain/community/vectorstores/pgvector';
import { Document } from '@langchain/core/documents';
import { OllamaEmbeddings } from '@langchain/ollama';
import { v4 } from 'uuid';

export const invokePGVector = async (query: string) => {
  // Ollama Embeddings configurations
  const embeddings = new OllamaEmbeddings({
    model: 'mxbai-embed-large:latest',
    baseUrl: 'http://localhost:11434',
  });

  // pg-vector configurations
  const config = {
    postgresConnectionOptions: {
      connectionString: 'postgresql://postgres:123@127.0.0.1:5432/ai-pg-vector',
    } as PoolConfig,
    tableName: 'testlangchainjs',
    columns: {
      idColumnName: 'id',
      vectorColumnName: 'vector',
      contentColumnName: 'content',
      metadataColumnName: 'metadata',
    },
    distanceStrategy: 'cosine' as DistanceStrategy,
  };

  // initialize vector store
  const vectorStore = await PGVectorStore.initialize(embeddings, config);

  // rag documents
  const document1: Document = {
    pageContent: 'benben在地球',
    metadata: {
      name: 'd1',
    },
  };
  const document2: Document = {
    pageContent: 'benben会飞',
    metadata: {
      name: 'd2',
    },
  };
  const document3: Document = {
    pageContent: 'benben喜欢吃苹果',
    metadata: {
      name: 'd3',
    },
  };

  const ids = [v4(), v4(), v4()];

  // add documents to vector store
  await vectorStore.addDocuments([document1, document2, document3], { ids });

  // query
  const vector = await embeddings.embedQuery(query);

  // 基于向量的相似度检索，返回最相似的一个结果
  const results = await vectorStore.similaritySearchVectorWithScore(vector, 1);

  console.log(results);
};
