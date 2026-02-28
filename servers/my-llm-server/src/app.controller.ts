import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
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
}
