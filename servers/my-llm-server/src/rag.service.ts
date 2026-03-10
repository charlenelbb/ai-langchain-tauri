import { Injectable } from '@nestjs/common';
import { Document } from '@langchain/core/documents';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { ingestToPGVector, searchPGVector } from './fundamentals/pg-vector';
import { v4 as uuidv4 } from 'uuid';

export type RagIngestOptions = {
  kbId?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  tableName?: string;
};

export type RagSearchOptions = {
  kbId?: string;
  topK?: number;
  tableName?: string;
};

@Injectable()
export class RagService {
  async ingestFiles(
    files: Array<{
      originalname?: string;
      mimetype?: string;
      buffer: Buffer;
      size?: number;
    }>,
    opts?: RagIngestOptions,
  ) {
    const kbId = (opts?.kbId || 'default').trim() || 'default';
    const chunkSize = opts?.chunkSize ?? 800;
    const chunkOverlap = opts?.chunkOverlap ?? 100;
    const tableName = opts?.tableName;

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
    });

    const docs: Document[] = [];

    for (const f of files) {
      const name = f.originalname || 'uploaded';
      const mime = (f.mimetype || '').toLowerCase();

      // 先支持最常见的“文本类文件”；PDF/DOCX 等可以后续加 loader
      const isTextLike =
        mime.startsWith('text/') ||
        mime.includes('json') ||
        mime.includes('xml') ||
        mime.includes('csv') ||
        mime.includes('markdown') ||
        mime === '';

      if (!isTextLike) {
        throw new Error(`暂不支持的文件类型: ${mime || 'unknown'} (${name})`);
      }

      const raw = f.buffer.toString('utf-8');
      const pieces = await splitter.splitText(raw);
      pieces.forEach((p, idx) => {
        const d: Document = {
          pageContent: p,
          metadata: {
            kbId,
            source: name,
            chunkIndex: idx,
            mime,
            bytes: f.size ?? f.buffer.length,
          },
        };
        docs.push(d);
      });
    }

    const ids = docs.map(() => uuidv4());
    const inserted = await ingestToPGVector(docs, { tableName, ids });

    return {
      ok: true,
      kbId,
      files: files.map((f) => ({
        name: f.originalname || 'uploaded',
        bytes: f.size ?? f.buffer.length,
      })),
      chunks: docs.length,
      tableName: inserted.tableName,
    };
  }

  async search(query: string, opts?: RagSearchOptions) {
    const kbId = (opts?.kbId || 'default').trim() || 'default';
    const topK = opts?.topK ?? 4;
    const tableName = opts?.tableName;

    const results = await searchPGVector(query, {
      tableName,
      topK,
      filter: { kbId },
    });

    return {
      ok: true,
      kbId,
      query,
      topK,
      results,
    };
  }
}

