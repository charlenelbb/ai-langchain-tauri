// AI 提示词实战

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOllama } from '@langchain/ollama';

// 创建模型实例
const llm = new ChatOllama({
  model: 'qwen3:0.6b',
});

export const invokePrompt = async (msg: string) => {
  // 创建对话
  const conversation = [
    new SystemMessage('你是软件开发专家，协助我完成各种任务。'),
    new HumanMessage(msg),
  ];

  const response = await llm.invoke(conversation);
  const str = response.content.toString();
  return str.slice(str.indexOf('\n')).replaceAll('/\/think/gi', '');
};

// 流式 prompt
export const invokePromptStream = async function* (msg: string) {
  const conversation = [
    new SystemMessage('你是软件开发专家，协助我完成各种任务。'),
    new HumanMessage(msg),
  ];

  // 使用 stream 方法获取流式响应
  const stream = await llm.stream(conversation);

  for await (const chunk of stream) {
    if (chunk.content) {
      yield chunk.content.toString();
    }
  }
};
