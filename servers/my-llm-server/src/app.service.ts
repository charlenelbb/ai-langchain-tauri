import { Injectable } from '@nestjs/common';
import { invokePrompt, invokePromptStream } from './fundamentals/prompt';
import { invokeRAG } from './fundamentals/rag';
import { invokePGVector } from './fundamentals/pg-vector';
import { analyzeMedicalImage } from './fundamentals/medical';

@Injectable()
export class AppService {
  rag(query: string) {
    const response = invokePGVector(query);
    return response;
  }
  async prompt(msg: string): Promise<any> {
    const response = await invokePrompt(msg);
    return response;
  }
  async *promptStream(msg: string) {
    yield* invokePromptStream(msg);
  }
  async medicalAnalysis(fileBuffer: Buffer, question: string) {
    // 将文件转为 Base64 字符串
    const base64 = fileBuffer.toString('base64');
    const result = await analyzeMedicalImage(base64, question);
    return result;
  }
  getHello(): string {
    return 'Hello World!';
  }
}
