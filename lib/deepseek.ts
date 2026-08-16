/**
 * DeepSeek 文本生成（OpenAI 兼容 API）
 *
 * 端点：POST https://api.deepseek.com/chat/completions
 * 文档：https://api-docs.deepseek.com
 */
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

function getDeepseekHeaders(apiKey: string) {
  const normalizedApiKey = apiKey.trim();
  if (!normalizedApiKey) {
    throw new Error('缺少 DeepSeek API Key，请在设置中填写。');
  }

  return {
    Authorization: `Bearer ${normalizedApiKey}`,
    'Content-Type': 'application/json',
  };
}

function parseDeepseekError(payload: unknown, status: number) {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = payload.error;
    if (
      error &&
      typeof error === 'object' &&
      'message' in error &&
      typeof error.message === 'string'
    ) {
      return error.message;
    }
  }

  return `DeepSeek 请求失败，状态码 ${status}`;
}

function extractDeepseekText(payload: unknown) {
  const content = (
    payload as { choices?: Array<{ message?: { content?: unknown } }> }
  )?.choices?.[0]?.message?.content;

  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) =>
        item && typeof item === 'object' && 'text' in item
          ? String((item as { text?: string }).text || '')
          : ''
      )
      .join('\n')
      .trim();
  }

  return '';
}

export async function runDeepseekText({
  apiKey,
  model,
  prompt,
  contextText,
}: {
  apiKey: string;
  model: string;
  prompt: string;
  contextText: string[];
}) {
  const normalizedApiKey = apiKey.trim();
  if (!normalizedApiKey) {
    throw new Error('缺少 DeepSeek API Key，请在设置中填写。');
  }

  const normalizedModel = model.trim() || 'deepseek-chat';
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    throw new Error('文本节点需要填写提示词。');
  }

  const userMessage = [
    contextText.length > 0
      ? `上游上下文：\n${contextText.join('\n\n---\n\n')}`
      : '',
    normalizedPrompt,
  ]
    .filter(Boolean)
    .join('\n\n');

  const response = await fetch(
    `${DEFAULT_DEEPSEEK_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: getDeepseekHeaders(apiKey),
      body: JSON.stringify({
        model: normalizedModel,
        stream: false,
        messages: [
          {
            role: 'system',
            content:
              '你是一个创意助手。请直接返回最终答案，除非用户明确要求特定格式。',
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
      }),
    }
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(parseDeepseekError(payload, response.status));
  }

  const text = extractDeepseekText(payload);
  if (!text) {
    throw new Error('DeepSeek 返回了空内容。');
  }

  return {
    text,
    payload,
  };
}
