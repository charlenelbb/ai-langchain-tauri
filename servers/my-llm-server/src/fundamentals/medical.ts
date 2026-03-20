/**
 * 医疗问答：调用百炼（DashScope）qwen3.5-plus，支持图像 + 文本。
 * 使用多模态接口传图+问题；若接口不支持则仅传文本。
 */

// 多模态（带图）模型
const MODEL_MULTIMODAL = 'qwen3.5-plus';
// 纯文本（不带图）模型
const MODEL_TEXT = 'qwen3-max';
const SYSTEM_PROMPT =
  '你是一个资深的医疗专家。患者上传了一张图像，请根据图像内容和问题给出中文可能的症状分析和治疗建议。若未提供图像，仅根据文字描述作答。';

export type MedicalResult = { reasoning?: string; content: string };

type DashScopeMessage = {
  content?: string | Array<{ text?: string }>;
  reasoning_content?: string | Array<{ text?: string }>;
};

type DashScopeResponse = {
  output?: {
    choices?: Array<{ message?: DashScopeMessage }>;
  };
  code?: string;
  message?: string;
};

function extractMessageText(
  content: string | Array<{ text?: string }> | undefined,
): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  return content.map((c) => (c?.text ?? '')).join('');
}

async function callDashScopeChat(
  apiKey: string,
  baseUrl: string,
  messages: Array<{ role: string; content: string | Array<{ image?: string; text?: string }> }>,
  model: string,
): Promise<MedicalResult> {
  const url = `${baseUrl}/services/aigc/text-generation/generation`;
  const body = {
    model,
    input: { messages },
    parameters: { result_format: 'message', enable_thinking: true },
  };

  const fetchWithTimeout = async (requestUrl: string, timeoutMs: number) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(requestUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  const requestOnce = async (requestUrl: string) => {
    // 给纯文本生成一个明确超时，避免无限等待导致“接口超时”
    // 如遇超时会走后续 dashscope-intl 兜底重试
    return await fetchWithTimeout(requestUrl, 45000);
  };

  let resp: Response;
  try {
    resp = await requestOnce(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    // 常见是 DNS/网络导致 dashscope 域名不可达：重试 dashscope-intl
    const hasIntl = baseUrl.includes('dashscope-intl');
    const fallbackBaseUrl = hasIntl
      ? baseUrl
      : (baseUrl.replace('dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com') ||
          'https://dashscope-intl.aliyuncs.com/api/v1');

    if (!hasIntl && fallbackBaseUrl !== baseUrl) {
      const fallbackUrl = `${fallbackBaseUrl}/services/aigc/text-generation/generation`;
      try {
        resp = await requestOnce(fallbackUrl);
      } catch {
        throw new Error(
          `请求 DashScope 失败（可能是网络/DNS/代理问题）：${msg}\n` +
            `当前 baseUrl=${baseUrl}\n` +
            `建议：如果你在海外或当前网络无法解析 dashscope.aliyuncs.com，请在 .env 设置 DASHSCOPE_BASE_URL=https://dashscope-intl.aliyuncs.com/api/v1`,
        );
      }
    } else {
      throw new Error(
        `请求 DashScope 失败（可能是网络/DNS/代理问题）：${msg}\n` +
          `当前 baseUrl=${baseUrl}\n` +
          `建议：检查 .env 中 DASHSCOPE_BASE_URL，并确保服务器网络可以访问 dashscope 域名。`,
      );
    }
  }

  const raw = await resp.text();
  let json: DashScopeResponse | undefined;
  if (raw?.trim()) {
    try {
      json = JSON.parse(raw) as DashScopeResponse;
    } catch {
      json = undefined;
    }
  }

  if (!resp.ok) {
    throw new Error(
      json?.message || `请求失败: ${resp.status} ${resp.statusText}\n${raw?.slice(0, 300)}`,
    );
  }

  if (json?.code) {
    throw new Error(json.message || json.code);
  }

  const msg = json?.output?.choices?.[0]?.message;
  const content = extractMessageText(msg?.content);
  const reasoning = extractMessageText(msg?.reasoning_content);
  if (content === '' && reasoning === '') {
    throw new Error('响应中无 content');
  }
  return { reasoning: reasoning || undefined, content: content || '' };
}

/**
 * 纯文本流式推理：使用 DashScope OpenAI-compatible 的 streaming（SSE）。
 * 返回思考/回答两类增量片段，供后端直接转发给前端。
 */
async function* callDashScopeChatStream(
  apiKey: string,
  baseUrl: string,
  messages: Array<{ role: string; content: string | Array<{ image?: string; text?: string }> }>,
  model: string,
): AsyncGenerator<{ type: 'thinking' | 'chunk'; chunk: string }, void, unknown> {
  // 将 baseUrl 从 /api/v1 或兼容域名转换到 /compatible-mode/v1
  const host = baseUrl
    .replace(/\/api\/v1\/?$/, '')
    .replace(/\/compatible-mode\/v1\/?$/, '')
    .replace(/\/$/, '');
  const url = `${host}/compatible-mode/v1/chat/completions`;

  const requestBody = {
    model,
    messages,
    stream: true,
    enable_thinking: true,
    stream_options: { include_usage: true },
  };

  const controller = new AbortController();
  // streaming 生成可能较慢；避免 60s 后被主动 abort
  const streamTimeoutMs = Number(process.env.DASHSCOPE_STREAM_TIMEOUT_MS ?? 180000);
  const timer = setTimeout(() => controller.abort(), streamTimeoutMs);

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const raw = await resp.text().catch(() => '');
      throw new Error(
        `DashScope streaming 请求失败: ${resp.status} ${resp.statusText}\n${raw.slice(0, 300)}`,
      );
    }

    // 解析 SSE：每个事件以空行分隔，事件行形如 `data: {...}`
    const reader = (resp.body as any)?.getReader?.();
    if (!reader) {
      throw new Error('DashScope streaming: response.body 不可读取');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;

    while (!done) {
      const { value, done: doneReading } = await reader.read();
      done = doneReading;
      if (value)
        buffer += decoder.decode(value, { stream: !doneReading });

      while (true) {
        const sepIdx = buffer.indexOf('\n\n');
        if (sepIdx < 0) break;

        const eventText = buffer.slice(0, sepIdx).trim();
        buffer = buffer.slice(sepIdx + 2);
        if (!eventText) continue;

        const lines = eventText.split('\n').map((l) => l.trim());
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const dataStr = line.slice('data:'.length).trim();
          if (!dataStr || dataStr === '[DONE]') {
            done = true;
            break;
          }

          let json: any;
          try {
            json = JSON.parse(dataStr);
          } catch {
            continue;
          }

          const delta = json?.choices?.[0]?.delta;
          const reasoningChunk =
            typeof delta?.reasoning_content === 'string'
              ? delta.reasoning_content
              : '';
          const contentChunk =
            typeof delta?.content === 'string' ? delta.content : '';

          if (reasoningChunk) {
            yield { type: 'thinking', chunk: reasoningChunk };
          }
          if (contentChunk) {
            yield { type: 'chunk', chunk: contentChunk };
          }
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 通过上传的图像和文本问题进行医学诊断建议（百炼 qwen3.5-plus）
 * @param base64Image 图片的 Base64 编码字符串（可为空，则仅文本）
 * @param question 用户的文本描述或提问
 */
export const analyzeMedicalImage = async (
  base64Image: string,
  question: string,
): Promise<MedicalResult> => {
  const apiKey = process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      '未配置 DASHSCOPE_API_KEY。请在 .env 中设置后重启。',
    );
  }

  const baseUrl =
    process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1';

  // 多模态接口（图像+文本）：使用 multimodal-generation，content 为数组
  const multimodalUrl = `${baseUrl}/services/aigc/multimodal-generation/generation`;
  const hasImage = Boolean(base64Image?.trim());

  if (hasImage) {
    const imageDataUrl = base64Image.startsWith('data:')
      ? base64Image
      : `data:image/jpeg;base64,${base64Image}`;
    const body = {
      model: MODEL_MULTIMODAL,
      input: {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { image: imageDataUrl },
              { text: question || '请根据图像内容给出医学分析建议。' },
            ],
          },
        ],
      },
      parameters: { result_format: 'message', enable_thinking: true },
    };

    let resp: Response;
    try {
      const controller = new AbortController();
      const nonStreamTimeoutMs = Number(process.env.DASHSCOPE_NONSTREAM_TIMEOUT_MS ?? 180000);
      const timer = setTimeout(() => controller.abort(), nonStreamTimeoutMs);
      try {
        resp = await fetch(multimodalUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `请求 DashScope 失败（可能是网络/DNS/代理问题）：${msg}\n` +
        `当前 baseUrl=${baseUrl}\n` +
        `建议：如果你在海外或当前网络无法解析 dashscope.aliyuncs.com，请在 .env 设置 DASHSCOPE_BASE_URL=https://dashscope-intl.aliyuncs.com/api/v1`,
      );
    }

    const raw = await resp.text();
    let json: DashScopeResponse | undefined;
    if (raw?.trim()) {
      try {
        json = JSON.parse(raw) as DashScopeResponse;
      } catch {
        json = undefined;
      }
    }

    if (!resp.ok) {
      throw new Error(
        json?.message || `请求失败: ${resp.status} ${resp.statusText}\n${raw?.slice(0, 300)}`,
      );
    }
    if (json?.code) {
      throw new Error(json.message || json.code);
    }

    const msg = json?.output?.choices?.[0]?.message;
    const content = extractMessageText(msg?.content);
    const reasoning = extractMessageText(msg?.reasoning_content);
    if (content === '' && reasoning === '') {
      throw new Error('响应中无 content');
    }
    return { reasoning: reasoning || undefined, content: content || '' };
  }

  // 无图时走纯文本
  return callDashScopeChat(
    apiKey,
    baseUrl,
    [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: question || '请简要说明您的症状或问题。' },
    ],
    MODEL_TEXT,
  );
};

/**
 * 纯文本流式医学分析（仅用于 SSE：避免纯文本等待完整结果导致超时）
 */
export async function* analyzeMedicalTextStream(
  question: string,
): AsyncGenerator<{ type: 'thinking' | 'chunk'; chunk: string }, void, unknown> {
  const apiKey = process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      '未配置 DASHSCOPE_API_KEY。请在 .env 中设置后重启。',
    );
  }
  const baseUrl =
    process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1';

  yield* callDashScopeChatStream(
    apiKey,
    baseUrl,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: question || '请简要说明您的症状或问题。' },
    ],
    MODEL_TEXT,
  );
}
