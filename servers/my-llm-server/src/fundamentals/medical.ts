import { ChatOllama } from '@langchain/ollama';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

// 使用同一个模型，也可以调整为专门的医用模型
const llm = new ChatOllama({
  model: 'qwen3.5:0.8b',
});

/**
 * 通过上传的图像和文本问题进行医学诊断建议
 * @param base64Image 图片的 Base64 编码字符串
 * @param question 用户的文本描述或提问
 */
export const analyzeMedicalImage = async (
  base64Image: string,
  question: string,
): Promise<string> => {
  // 可以在这里实施更复杂的图像分析（OCR、识别症状等），
  // 当前简单地将 Base64 附在提示词中交给 LLM 处理

  const conversation = [
    new SystemMessage(
      '你是一个资深的医疗专家。患者上传了一张图像, 请根据图像内容和问题给出中文可能的症状分析和治疗建议。',
    ),
    new HumanMessage(`图像(Base64): ${base64Image}\n问题: ${question}`),
  ];

  const response = await llm.invoke(conversation);
  console.log('response:', response.content.toString());
  return response.content.toString();
};
