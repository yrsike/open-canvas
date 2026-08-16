/**
 * MiniMax 图像 + 视频生成
 *
 * 图片：POST https://api.minimaxi.com/v1/image_generation
 * 视频：POST https://api.minimax.com/v2/video_generation
 * 文档：https://platform.minimaxi.com/docs
 */

const MINIMAX_IMAGE_URL = 'https://api.minimaxi.com/v1/image_generation';
const MINIMAX_VIDEO_URL = 'https://api.minimax.com/v2/video_generation';

function getMinimaxHeaders(apiKey: string) {
  const normalizedApiKey = apiKey.trim();
  if (!normalizedApiKey) {
    throw new Error('缺少 MiniMax API Key，请在设置中填写。');
  }

  return {
    Authorization: `Bearer ${normalizedApiKey}`,
    'Content-Type': 'application/json',
  };
}

function parseMinimaxError(payload: unknown, status: number) {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const base =
      record.base_resp &&
      typeof record.base_resp === 'object'
        ? (record.base_resp as Record<string, unknown>)
        : null;
    const message =
      base && typeof base.status_msg === 'string'
        ? base.status_msg
        : typeof record.message === 'string'
          ? record.message
          : '';
    if (message) {
      return message;
    }
  }

  return `MiniMax 请求失败，状态码 ${status}`;
}

function firstString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) {
        return item;
      }
    }
  }
  return '';
}

/**
 * 创建图片生成任务
 */
export async function createMinimaxImageGeneration({
  apiKey,
  prompt,
  aspectRatio,
  resolution,
  subjectReferenceUrl,
}: {
  apiKey: string;
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  subjectReferenceUrl?: string | null;
}) {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    throw new Error('图片节点需要填写提示词。');
  }

  const body: Record<string, unknown> = {
    model: 'image-01',
    prompt: normalizedPrompt,
    aspect_ratio: aspectRatio || '1:1',
    n: 1,
    resolution: resolution || '1K',
  };

  if (subjectReferenceUrl) {
    body.subject_reference = [
      {
        type: 'character',
        image_file: subjectReferenceUrl,
      },
    ];
  }

  const response = await fetch(MINIMAX_IMAGE_URL, {
    method: 'POST',
    headers: getMinimaxHeaders(apiKey),
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(parseMinimaxError(payload, response.status));
  }

  const taskId =
    payload && typeof payload === 'object' && 'task_id' in payload
      ? String((payload as Record<string, unknown>).task_id)
      : '';

  return {
    taskId,
  };
}

export async function queryMinimaxImageTask({
  apiKey,
  taskId,
}: {
  apiKey: string;
  taskId: string;
}) {
  const response = await fetch(`${MINIMAX_IMAGE_URL}/${taskId}`, {
    method: 'GET',
    headers: getMinimaxHeaders(apiKey),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(parseMinimaxError(payload, response.status));
  }

  const status =
    payload && typeof payload === 'object' && 'status' in payload
      ? String((payload as Record<string, unknown>).status)
      : '';

  if (status === 'succeeded') {
    const result =
      payload && typeof payload === 'object' && 'result' in payload
        ? (payload as Record<string, unknown>).result
        : null;
    const urls =
      result && typeof result === 'object' && 'image_urls' in result
        ? (result as Record<string, unknown>).image_urls
        : null;
    return {
      status: 'success',
      outputMediaUrl: firstString(urls),
    };
  }

  if (status === 'failed' || status === 'cancelled') {
    return {
      status: 'error',
      outputMediaUrl: '',
    };
  }

  return {
    status: 'running',
    outputMediaUrl: '',
  };
}

/**
 * 创建视频生成任务（文生视频 / 图生视频）
 */
export async function createMinimaxVideoGeneration({
  apiKey,
  prompt,
  duration,
  resolution,
  firstFrameUrl,
}: {
  apiKey: string;
  prompt: string;
  duration?: string;
  resolution?: string;
  firstFrameUrl?: string | null;
}) {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    throw new Error('视频节点需要填写提示词。');
  }

  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: normalizedPrompt },
  ];

  if (firstFrameUrl) {
    content.push({
      type: 'image_url',
      image_url: firstFrameUrl,
      role: 'first_frame',
    });
  }

  const body: Record<string, unknown> = {
    model: 'MiniMax-H3',
    content,
    resolution: resolution || '768P',
    duration: Number(duration) || 5,
  };

  if (!firstFrameUrl) {
    body.ratio = '9:16';
  }

  const response = await fetch(MINIMAX_VIDEO_URL, {
    method: 'POST',
    headers: getMinimaxHeaders(apiKey),
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(parseMinimaxError(payload, response.status));
  }

  const taskId =
    payload && typeof payload === 'object' && 'task_id' in payload
      ? String((payload as Record<string, unknown>).task_id)
      : '';

  return {
    taskId,
  };
}

export async function queryMinimaxVideoTask({
  apiKey,
  taskId,
}: {
  apiKey: string;
  taskId: string;
}) {
  const response = await fetch(`${MINIMAX_VIDEO_URL}/${taskId}`, {
    method: 'GET',
    headers: getMinimaxHeaders(apiKey),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(parseMinimaxError(payload, response.status));
  }

  const task =
    payload && typeof payload === 'object' && 'task' in payload
      ? (payload as Record<string, unknown>).task
      : payload;

  const status =
    task && typeof task === 'object' && 'status' in task
      ? String((task as Record<string, unknown>).status)
      : '';

  if (status === 'succeeded') {
    const content =
      task && typeof task === 'object' && 'content' in task
        ? (task as Record<string, unknown>).content
        : null;
    const url =
      content && typeof content === 'object' && 'url' in content
        ? String((content as Record<string, unknown>).url)
        : '';
    return {
      status: 'success',
      outputMediaUrl: url,
    };
  }

  if (status === 'failed' || status === 'cancelled') {
    return {
      status: 'error',
      outputMediaUrl: '',
    };
  }

  return {
    status: 'running',
    outputMediaUrl: '',
  };
}
