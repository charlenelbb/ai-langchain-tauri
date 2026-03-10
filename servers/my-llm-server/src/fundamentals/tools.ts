// 各种供 LangChain 风格 agent 调用的"工具"集合。
// 基于现有功能（医学分析、RAG、PGVector 查询等）导出统一接口。

import { analyzeMedicalImage } from './medical';
import { invokeRAG } from './rag';
import { invokePGVector } from './pg-vector';

/**
 * 简单的工具接口，用于 agent 调用。
 * 如果未来引入正式的 LangChain 工具类，可以在此处改造。
 */
export interface AgentTool {
  /** 唯一名称，agent 通过名称选定工具 */
  name: string;
  /** 说明，agent 在生成提示时可参考 */
  description: string;
  /** 执行函数，返回任意结果，可同步或异步 */
  func: (...args: any[]) => Promise<any> | any;
}

/**
 * 当前可用的工具列表。agent 可以遍历并根据需要执行其中一个。
 */
export const tools: AgentTool[] = [
  {
    name: 'analyzeMedicalImage',
    description:
      '给定 Base64 编码的医学图像和一个问题，返回可能的症状分析与建议。参数: (base64Image: string, question: string)',
    func: analyzeMedicalImage,
  },
  {
    name: 'invokeRAG',
    description:
      '在内存向量存储上执行检索增强生成。传入查询字符串，返回相似度结果。参数: (query: string)',
    func: invokeRAG,
  },
  {
    name: 'invokePGVector',
    description:
      '向 PostgreSQL 向量数据库提出查询并返回检索结果。参数: (query: string)',
    func: invokePGVector,
  },
];

/**
 * 根据名称查找工具的简单辅助函数。
 */
export const getToolByName = (name: string): AgentTool | undefined => {
  return tools.find((t) => t.name === name);
};

// 导出函数供 workflow.service 使用
export { analyzeMedicalImage, invokeRAG, invokePGVector };
