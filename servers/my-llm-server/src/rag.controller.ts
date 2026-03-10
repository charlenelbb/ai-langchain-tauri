import {
  Body,
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { RagService } from './rag.service';

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Post('ingest')
  @UseInterceptors(FilesInterceptor('files'))
  async ingest(
    @UploadedFiles() files: any[],
    @Body('kbId') kbId?: string,
    @Body('chunkSize') chunkSize?: string,
    @Body('chunkOverlap') chunkOverlap?: string,
  ) {
    if (!files || files.length === 0) {
      return { ok: false, error: '没有上传文件（字段名请使用 files）' };
    }

    return await this.ragService.ingestFiles(files, {
      kbId,
      chunkSize: chunkSize ? parseInt(chunkSize, 10) : undefined,
      chunkOverlap: chunkOverlap ? parseInt(chunkOverlap, 10) : undefined,
    });
  }

  @Post('search')
  async search(
    @Body('query') query: string,
    @Body('kbId') kbId?: string,
    @Body('topK') topK?: number,
  ) {
    if (!query || !query.trim()) {
      return { ok: false, error: 'query 不能为空' };
    }
    return await this.ragService.search(query.trim(), {
      kbId,
      topK: topK ?? 4,
    });
  }
}

