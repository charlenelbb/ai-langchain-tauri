/**
 * 医疗问答：调用百炼（DashScope）qwen3.5-plus，支持图像 + 文本。
 * 使用多模态接口传图+问题；若接口不支持则仅传文本。
 */

const MODEL = 'qwen3.5-plus';
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
): Promise<MedicalResult> {
  const url = `${baseUrl}/services/aigc/text-generation/generation`;
  const body = {
    model: MODEL,
    input: { messages },
    parameters: { result_format: 'message', enable_thinking: true },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

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
      model: MODEL,
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
      resp = await fetch(multimodalUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
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
  return callDashScopeChat(apiKey, baseUrl, [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: question || '请简要说明您的症状或问题。' },
  ]);
};
