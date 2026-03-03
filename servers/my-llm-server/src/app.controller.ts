import {
  Controller,
  Get,
  Query,
  Res,
  Post,
  Body,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('prompt')
  async prompt(@Query('message') msg: string): Promise<string> {
    return await this.appService.prompt(msg);
  }

  @Get('rag')
  async rag(@Query('query') query: string): Promise<any> {
    const response = await this.appService.rag(query);
    return response;
  }

  @Get('sse')
  async sse(
    @Query('query') query: string,
    @Res() res: Response,
  ): Promise<void> {
    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
      // 发送初始连接成功事件
      res.write('event: open\n');
      res.write(`data: SSE连接已建立\n\n`);

      // 获取流式响应
      const stream = this.appService.promptStream(query);

      // 逐个发送数据
      for await (const chunk of stream) {
        res.write('event: message\n');
        res.write(`data: ${chunk}\n\n`);
      }

      // 发送完成事件
      res.write('event: done\n');
      res.write('data: 流已完成\n\n');
      res.end();
    } catch (error) {
      res.write('event: error\n');
      res.write(
        `data: ${error instanceof Error ? error.message : '未知错误'}\n\n`,
      );
      res.end();
    }
  }

  @Post('medical')
  @UseInterceptors(FileInterceptor('image'))
  async medical(
    @UploadedFile() file: any,
    @Body('question') question: string,
    @Res() res: Response,
  ) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!file) {
      return res.status(400).json({ error: '没有上传图片' });
    }
    try {
      const answer = await this.appService.medicalAnalysis(
        file.buffer,
        question,
      );
      return res.json({ answer });
    } catch (err) {
      return res
        .status(500)
        .json({ error: err instanceof Error ? err.message : '处理失败' });
    }
  }

  // 接收训练数据并触发 LoRA 微调
  @Post('lora/train')
  @UseInterceptors(FileInterceptor('file'))
  async loraTrain(
    @UploadedFile() file: any,
    @Body('model_name') modelName: string,
    @Body('output_dir') outputDir: string,
    @Body('num_train_epochs') numTrainEpochs: string,
    @Body('per_device_train_batch_size') perDeviceTrainBatchSize: string,
    @Body('learning_rate') learningRate: string,
    @Body('lora_r') loraR: string,
    @Body('lora_alpha') loraAlpha: string,
    @Body('lora_dropout') loraDropout: string,
    @Body('use_int8') useInt8: string,
  ) {
    if (!file) {
      return { error: '没有上传训练文件' };
    }

    const params = {
      modelName,
      outputDir: outputDir || `./uploads/lora_${Date.now()}`,
      numTrainEpochs: parseInt(numTrainEpochs || '3', 10),
      perDeviceTrainBatchSize: parseInt(perDeviceTrainBatchSize || '4', 10),
      learningRate: parseFloat(learningRate || '2e-4'),
      loraR: parseInt(loraR || '8', 10),
      loraAlpha: parseInt(loraAlpha || '32', 10),
      loraDropout: parseFloat(loraDropout || '0.1'),
      useInt8: useInt8 === 'true' || useInt8 === '1',
    };

    const jobId = await this.appService.startLoraTraining(
      file.buffer,
      file.originalname,
      params,
    );

    return { jobId, outputDir: params.outputDir };
  }

  // 查询训练日志（返回整个日志内容）
  @Get('lora/status')
  async loraStatus(@Query('jobId') jobId: string) {
    if (!jobId) return { error: 'missing jobId' };
    const log = await this.appService.getTrainingLog(jobId);
    return { jobId, log };
  }
}
