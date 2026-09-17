/**
 * 百炼（DashScope）OpenAI 兼容聊天：非流式 JSON 与 SSE 流式共用。
 */

export type DashScopeChatMessage = {
  role: string;
  content: string | Array<{ image?: string; text?: string }>;
};

export type DashScopeStreamChunk = { type: 'thinking' | 'chunk'; chunk: string };

export function getDashScopeApiKey(): string {
  const apiKey = process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('未配置 DASHSCOPE_API_KEY。请在 .env 中设置后重启。');
  }
  return apiKey;
}

export function getDashScopeBaseUrl(): string {
  return process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1';
}

export function toCompatibleChatUrl(baseUrl: string): string {
  const host = baseUrl
    .replace(/\/api\/v1\/?$/, '')
    .replace(/\/compatible-mode\/v1\/?$/, '')
    .replace(/\/$/, '');
  return `${host}/compatible-mode/v1/chat/completions`;
}

export async function callDashScopeChatComplete(options: {
  messages: DashScopeChatMessage[];
  model: string;
  enableThinking?: boolean;
  timeoutMs?: number;
}): Promise<string> {
  const apiKey = getDashScopeApiKey();
  const baseUrl = getDashScopeBaseUrl();
  const url = toCompatibleChatUrl(baseUrl);
  const timeoutMs = options.timeoutMs ?? 45000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        stream: false,
        enable_thinking: options.enableThinking ?? false,
      }),
      signal: controller.signal,
    });

    const raw = await resp.text();
    let json: any;
    if (raw?.trim()) {
      try {
        json = JSON.parse(raw);
      } catch {
        json = undefined;
      }
    }
    if (!resp.ok) {
      throw new Error(
        json?.error?.message ||
          json?.message ||
          `DashScope 请求失败: ${resp.status} ${resp.statusText}\n${raw.slice(0, 300)}`,
      );
    }
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) return content.trim();
    throw new Error('DashScope 响应中无 content');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 纯文本流式推理：使用 DashScope OpenAI-compatible 的 streaming（SSE）。
 * 返回思考/回答两类增量片段，供后端直接转发给前端。
 */
export async function* callDashScopeChatStream(
  apiKey: string,
  baseUrl: string,
  messages: DashScopeChatMessage[],
  model: string,
  options?: { enableThinking?: boolean },
): AsyncGenerator<DashScopeStreamChunk, void, unknown> {
  const url = toCompatibleChatUrl(baseUrl);

  const requestBody: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (options?.enableThinking) {
    requestBody.enable_thinking = true;
  }

  const controller = new AbortController();
  const streamTimeoutMs = Number(process.env.DASHSCOPE_STREAM_TIMEOUT_MS ?? 180000);
  const timer = setTimeout(() => controller.abort(), streamTimeoutMs);

  try {
    const resp = await fetch(url, {
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
      if (value) buffer += decoder.decode(value, { stream: !doneReading });

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
