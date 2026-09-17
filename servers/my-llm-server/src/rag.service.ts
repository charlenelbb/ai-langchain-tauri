import { Injectable } from '@nestjs/common';
import { Document } from '@langchain/core/documents';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import mammoth from 'mammoth';
import {
  deleteFromPGVectorBySource,
  ingestToPGVector,
  searchPGVector,
} from './fundamentals/pg-vector';
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

const TEXT_EXTS = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'xml']);
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function decodeUploadFilename(name: string): string {
  if (!name) return 'uploaded';
  if (/[\u4e00-\u9fff]/.test(name)) return name;
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    if (decoded !== name && /[\u4e00-\u9fff]/.test(decoded)) {
      return decoded;
    }
  } catch {
    // keep original
  }
  return name;
}

function isDocx(mime: string, ext: string): boolean {
  return (
    ext === 'docx' ||
    mime === DOCX_MIME ||
    mime.includes('wordprocessingml.document')
  );
}

function isTextFile(mime: string, ext: string): boolean {
  if (isDocx(mime, ext)) return false;
  if (TEXT_EXTS.has(ext)) return true;
  if (mime.startsWith('text/')) return true;
  if (mime === 'application/json') return true;
  if (mime === 'application/xml' || mime === 'text/xml') return true;
  if (mime === 'text/csv' || mime === 'application/csv') return true;
  if (mime.includes('markdown')) return true;
  if (mime === '') return true;
  return false;
}

/** 先按 Markdown 标题切开，避免「发货时效」被埋进超大段后半。过长段再交给 RecursiveCharacterTextSplitter。 */
function splitByMarkdownHeadings(text: string): string[] {
  const parts = text
    .split(/(?=^#{1,3}\s)/m)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [text];
}

async function splitForIngest(
  raw: string,
  splitter: RecursiveCharacterTextSplitter,
): Promise<string[]> {
  const sections = splitByMarkdownHeadings(raw);
  const out: string[] = [];
  for (const section of sections) {
    const pieces = await splitter.splitText(section);
    for (const p of pieces) {
      const t = p.trim();
      if (t) out.push(t);
    }
  }
  return out.length ? out : [raw.trim()].filter(Boolean);
}

async function extractFileText(opts: {
  buffer: Buffer;
  mime: string;
  ext: string;
  name: string;
}): Promise<string> {
  if (isDocx(opts.mime, opts.ext)) {
    const mammothMd = mammoth as typeof mammoth & {
      convertToMarkdown: (input: { buffer: Buffer }) => Promise<{ value: string }>;
    };
    const md = await mammothMd.convertToMarkdown({ buffer: opts.buffer });
    let text = (md.value || '').replace(/\u0000/g, '').trim();
    if (!text) {
      const raw = await mammoth.extractRawText({ buffer: opts.buffer });
      text = (raw.value || '').replace(/\u0000/g, '').trim();
    }
    if (!text) {
      throw new Error(`无法从 Word 文档提取正文: ${opts.name}`);
    }
    return text;
  }

  if (opts.buffer.subarray(0, 2).toString() === 'PK') {
    throw new Error(
      `文件 ${opts.name} 看起来是压缩包/Office 文档，请上传 .docx 或纯文本`,
    );
  }

  const raw = opts.buffer.toString('utf-8').replace(/\u0000/g, '').trim();
  if (!raw) {
    throw new Error(`文件为空或无法按文本读取: ${opts.name}`);
  }
  return raw;
}

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
    const chunkSize = opts?.chunkSize ?? 400;
    const chunkOverlap = opts?.chunkOverlap ?? 100;
    const tableName = opts?.tableName;

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
    });

    const docs: Document[] = [];
    const ingestedNames: string[] = [];

    for (const f of files) {
      const originalName = f.originalname || 'uploaded';
      const name = decodeUploadFilename(originalName);
      const mime = (f.mimetype || '').toLowerCase();
      const ext = name.toLowerCase().split('.').pop() || '';

      if (!isDocx(mime, ext) && !isTextFile(mime, ext)) {
        throw new Error(`暂不支持的文件类型: ${mime || 'unknown'} (${name})`);
      }

      await deleteFromPGVectorBySource(kbId, [name, originalName], { tableName });

      const raw = await extractFileText({
        buffer: f.buffer,
        mime,
        ext,
        name,
      });
      const pieces = await splitForIngest(raw, splitter);
      pieces.forEach((p, idx) => {
        const d: Document = {
          pageContent: p,
          metadata: {
            kbId,
            source: name,
            chunkIndex: idx,
            mime: isDocx(mime, ext) ? DOCX_MIME : mime,
            bytes: f.size ?? f.buffer.length,
          },
        };
        docs.push(d);
      });
      ingestedNames.push(name);
    }

    const ids = docs.map(() => uuidv4());
    const inserted = await ingestToPGVector(docs, { tableName, ids });

    return {
      ok: true,
      kbId,
      files: files.map((f, i) => ({
        name: ingestedNames[i] || decodeUploadFilename(f.originalname || 'uploaded'),
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
