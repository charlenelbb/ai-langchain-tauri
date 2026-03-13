import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

type GenerateImageParams = {
  prompt: string;
  model?: string;
  size?: string;
  n?: number;
};

type OpenAIImagesResponse = {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message?: string };
};

@Injectable()
export class ImageService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(params: GenerateImageParams) {
    // DashScope（灵积）API Key，兼容你之前用的 OPENAI_API_KEY 命名
    const apiKey = process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        ok: false as const,
        error:
          '未配置 DASHSCOPE_API_KEY（或 OPENAI_API_KEY）。请在 servers/my-llm-server/.env 中设置 DASHSCOPE_API_KEY=... 后重启后端。',
      };
    }

    const prompt = (params.prompt || '').trim();
    if (!prompt) {
      return { ok: false as const, error: 'prompt 不能为空' };
    }

    const model = params.model || process.env.OPENAI_IMAGE_MODEL || 'qwen-image-2.0';
    const size = (params.size || '1024x1024').replace('x', '*');
    // qwen-image-2.0 同步接口通常返回 1 张；这里对齐，避免传参导致上游报错
    const n = 1;

    // 说明：
    // - 中国区默认 dashscope.aliyuncs.com
    // - 海外常用 dashscope-intl.aliyuncs.com
    // 如果你遇到 ENOTFOUND，请显式设置 DASHSCOPE_BASE_URL
    const baseUrl =
      process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1';
    const url = `${baseUrl}/services/aigc/multimodal-generation/generation`;

    // DashScope Qwen-Image 同步接口：返回图片 URL（24h 有效）
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          input: {
            messages: [
              {
                role: 'user',
                content: [{ text: prompt }],
              },
            ],
          },
          parameters: {
            size,
            watermark: false,
            prompt_extend: true,
          },
        }),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false as const,
        error:
          `请求 DashScope 失败（可能是网络/DNS/代理问题）：${msg}\n` +
          `当前 baseUrl=${baseUrl}\n` +
          `建议：如果你在海外或当前网络无法解析 dashscope.aliyuncs.com，请在 .env 设置 DASHSCOPE_BASE_URL=https://dashscope-intl.aliyuncs.com/api/v1`,
      };
    }

    // 兜底：上游可能返回空 body 或非 JSON，直接 resp.json() 会抛 Unexpected end of JSON input
    const rawText = await resp.text();
    let json: any | undefined;
    if (rawText && rawText.trim()) {
      try {
        json = JSON.parse(rawText);
      } catch {
        json = undefined;
      }
    }
    if (!resp.ok) {
      return {
        ok: false as const,
        error:
          json?.message ||
          `上游请求失败: ${resp.status} ${resp.statusText}${
            rawText ? `\n响应片段: ${rawText.slice(0, 400)}` : '\n响应体为空'
          }`,
      };
    }

    if (!json) {
      return {
        ok: false as const,
        error: `上游返回非 JSON 或空响应体（status=${resp.status}）`,
      };
    }

    const imageUrl =
      json?.output?.choices?.[0]?.message?.content?.find((c: any) => c?.image)
        ?.image || '';

    if (!imageUrl) {
      return {
        ok: false as const,
        error: `未拿到图片 URL（output.choices[0].message.content[].image 为空）\n响应片段: ${rawText.slice(
          0,
          400,
        )}`,
      };
    }

    // 下载图片并转 base64，保持前端展示逻辑不变
    let imgResp: Response;
    try {
      imgResp = await fetch(imageUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false as const,
        error: `下载图片失败（网络/DNS/代理问题）：${msg}`,
      };
    }
    if (!imgResp.ok) {
      return {
        ok: false as const,
        error: `下载图片失败: ${imgResp.status} ${imgResp.statusText}`,
      };
    }
    const mimeType = imgResp.headers.get('content-type') || 'image/png';
    const buf = Buffer.from(await imgResp.arrayBuffer());
    const b64 = buf.toString('base64');
    const images = [{ b64, mimeType }];

    if (images.length === 0) {
      return {
        ok: false as const,
        error: '未拿到图片数据（data 为空或缺少 b64_json）',
      };
    }

    // 写入历史记录（仅保存第一张）
    try {
      await this.prisma.client.imageGeneration.create({
        data: {
          prompt,
          model,
          size,
          mimeType,
          imageData: b64,
        },
      });
    } catch {
      // 忽略入库失败，不影响返回结果
    }

    return { ok: true as const, images, model, size, n };
  }

  /** 获取文生图历史列表，按创建时间倒序，默认最多 50 条 */
  async listHistory(limit = 50) {
    try {
      const list = await this.prisma.client.imageGeneration.findMany({
        orderBy: { createdAt: 'desc' },
        take: Math.min(Number(limit) || 50, 100),
        select: {
          id: true,
          prompt: true,
          model: true,
          size: true,
          mimeType: true,
          imageData: true,
          createdAt: true,
        },
      });
      return list.map((row) => ({
        id: row.id,
        prompt: row.prompt,
        model: row.model,
        size: row.size,
        mimeType: row.mimeType,
        imageData: row.imageData,
        createdAt: row.createdAt.toISOString(),
      }));
    } catch {
      return [];
    }
  }
}

