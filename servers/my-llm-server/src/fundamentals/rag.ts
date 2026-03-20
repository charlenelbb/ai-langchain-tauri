import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory';
import { createDashScopeTextEmbeddingsV4 } from './dashscope-embeddings';

const embeddings = createDashScopeTextEmbeddingsV4();

const text = '我是benben，我在地球。';

export const invokeRAG = async (query: string) => {
  // 存储
  const vectorStore = await MemoryVectorStore.fromDocuments(
    [
      {
        pageContent: text,
        metadata: { name: 'benben' },
      },
    ],
    embeddings,
  );

  // 检索
  // 一个向量
  const vector = await embeddings.embedQuery(query);

  // 检索内容
  const results = await vectorStore.similaritySearchVectorWithScore(vector, 1);

  return results;
};
