import { Injectable } from '@nestjs/common';
import { invokePrompt, invokePromptStream } from './fundamentals/prompt';
import { invokeRAG } from './fundamentals/rag';
import { invokePGVector } from './fundamentals/pg-vector';
import { analyzeMedicalImage } from './fundamentals/medical';

import { writeFile, mkdir, readFile, readdir, stat, unlink } from 'fs/promises';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { MemoryService } from './memory.service';

@Injectable()
export class AppService {
  constructor(private memoryService: MemoryService) {}
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

  // 启动 LoRA 训练任务（异步在后台运行），返回 jobId
  async startLoraTraining(
    fileBuffer: Buffer,
    originalName: string,
    params: any,
  ): Promise<string> {
    const jobId = randomUUID();
    const jobDir = path.resolve(process.cwd(), 'uploads', jobId);
    await mkdir(jobDir, { recursive: true });

    // 保存上传的训练文件
    const trainFilePath = path.join(jobDir, originalName || 'train_data.jsonl');
    await writeFile(trainFilePath, fileBuffer);

    // 日志文件
    const logPath = path.join(jobDir, 'train.log');

    // 构建 python 命令参数
    const scriptPath = path.resolve(
      process.cwd(),
      'scripts',
      'lora_finetune.py',
    );
    const args = [
      scriptPath,
      '--train_file',
      trainFilePath,
      '--model_name_or_path',
      params.modelName || 'gpt2',
      '--output_dir',
      params.outputDir,
      '--num_train_epochs',
      String(params.numTrainEpochs || 3),
      '--per_device_train_batch_size',
      String(params.perDeviceTrainBatchSize || 4),
      '--learning_rate',
      String(params.learningRate || 2e-4),
      '--lora_r',
      String(params.loraR || 8),
      '--lora_alpha',
      String(params.loraAlpha || 32),
      '--lora_dropout',
      String(params.loraDropout || 0.1),
    ];
    if (params.useInt8) args.push('--use_int8');

    // Spawn Python 子进程
    const py = spawn('python3', args, { cwd: process.cwd() });

    // 将 stdout/stderr 写入日志文件
    const logStream = (await import('fs')).createWriteStream(logPath, {
      flags: 'a',
    });
    py.stdout.on('data', (data) => {
      logStream.write(`[OUT] ${data.toString()}`);
    });
    py.stderr.on('data', (data) => {
      logStream.write(`[ERR] ${data.toString()}`);
    });
    py.on('close', (code) => {
      logStream.write(`[DONE] exit=${code}\n`);
      logStream.end();
    });

    return jobId;
  }

  async getTrainingLog(jobId: string): Promise<string> {
    try {
      const logPath = path.resolve(
        process.cwd(),
        'uploads',
        jobId,
        'train.log',
      );
      const exists = await readFile(logPath, { encoding: 'utf-8' }).catch(
        () => null,
      );
      if (!exists) return '日志尚未生成或任务仍在排队';
      return exists as string;
    } catch (err) {
      return `读取日志失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // -------------------- Session Management with LangChain Memory --------------------

  async listSessions(): Promise<any[]> {
    return await this.memoryService.listSessions();
  }

  async createSession(title?: string): Promise<any> {
    const sessionId = await this.memoryService.createSession(
      title || `会话 ${Date.now()}`,
    );
    return await this.memoryService.getSession(sessionId);
  }

  async getSession(id: string): Promise<any | null> {
    return await this.memoryService.getSession(id);
  }

  async appendMessage(sessionId: string, message: any): Promise<any> {
    if (message.sender === 'user') {
      await this.memoryService.addUserMessage(sessionId, message.text);
    } else if (message.sender === 'assistant') {
      await this.memoryService.addAssistantMessage(sessionId, message.text);
    }
    return await this.memoryService.getSession(sessionId);
  }

  async deleteSession(id: string): Promise<boolean> {
    await this.memoryService.deleteSession(id);
    return true;
  }

  async updateSessionTitle(id: string, title: string): Promise<any | null> {
    await this.memoryService.updateSessionTitle(id, title);
    return await this.memoryService.getSession(id);
  }

  async getSessionHistory(sessionId: string): Promise<any[]> {
    return await this.memoryService.getMessages(sessionId);
  }

  async getSessionContext(sessionId: string): Promise<string> {
    return await this.memoryService.getMemoryContext(sessionId);
  }

  // 获取 LangChain BufferMemory 对象，用于高级记忆操作
  async getSessionMemory(sessionId: string) {
    return await this.memoryService.getMemory(sessionId);
  }

  // 清除会话记忆
  async clearSessionMemory(sessionId: string): Promise<void> {
    await this.memoryService.clearMemory(sessionId);
  }
}
