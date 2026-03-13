import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ImageService } from './image.service';

@Controller('image')
export class ImageController {
  constructor(private readonly imageService: ImageService) {}

  @Get('history')
  async history(@Query('limit') limit?: string) {
    return await this.imageService.listHistory(limit ? parseInt(limit, 10) : undefined);
  }

  @Post('generate')
  async generate(
    @Body()
    body: { prompt?: string; model?: string; size?: string; n?: number },
  ) {
    return await this.imageService.generate({
      prompt: body.prompt || '',
      model: body.model,
      size: body.size,
      n: body.n,
    });
  }
}

