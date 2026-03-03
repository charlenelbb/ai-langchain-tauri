import { Injectable } from '@nestjs/common';
import { invokePrompt, invokePromptStream } from './fundamentals/prompt';
import { invokeRAG } from './fundamentals/rag';
import { invokePGVector } from './fundamentals/pg-vector';
import { analyzeMedicalImage } from './fundamentals/medical';

import { writeFile, mkdir, readFile } from 'fs/promises';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';

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
}
