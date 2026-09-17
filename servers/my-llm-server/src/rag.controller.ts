import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { RagService } from './rag.service';
import { Roles } from './auth/roles.decorator';
import { CurrentUser } from './auth/current-user.decorator';
import type { AuthUser } from './auth/auth.types';
import { assertRateLimit } from './auth/rate-limit';
import { AuditService } from './auth/audit.service';

@Controller('rag')
export class RagController {
  constructor(
    private readonly ragService: RagService,
    private readonly audit: AuditService,
  ) {}

  @Post('ingest')
  @Roles('agent')
  @UseInterceptors(FilesInterceptor('files'))
  async ingest(
    @CurrentUser() user: AuthUser,
    @UploadedFiles() files: any[],
    @Body('kbId') kbId?: string,
    @Body('chunkSize') chunkSize?: string,
    @Body('chunkOverlap') chunkOverlap?: string,
  ) {
    if (!assertRateLimit(`ingest:${user.id}`, 5, 60_000)) {
      throw new HttpException('入库过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!files || files.length === 0) {
      return { ok: false, error: '没有上传文件（字段名请使用 files）' };
    }

    try {
      const result = await this.ragService.ingestFiles(files, {
        kbId,
        chunkSize: chunkSize ? parseInt(chunkSize, 10) : undefined,
        chunkOverlap: chunkOverlap ? parseInt(chunkOverlap, 10) : undefined,
      });
      await this.audit.log({
        userId: user.id,
        action: 'rag.ingest',
        resource: `kb:${kbId || 'default'}`,
        detail: { chunks: result.chunks },
      });
      return result;
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
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
