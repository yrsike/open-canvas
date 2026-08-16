/**
 * 腾讯云 MPS「AI 换装」集成
 *
 * 接口：Action=ProcessImage（发起），Action=DescribeImageTaskDetail（查询）
 * 域名：mps.tencentcloudapi.com，版本：2019-06-12
 * 鉴权：TC3-HMAC-SHA256 签名 v3
 * 文档：https://cloud.tencent.com/document/product/862/132594
 */

const TENCENT_MPS_HOST = 'mps.tencentcloudapi.com';
const TENCENT_MPS_VERSION = '2019-06-12';

function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  return crypto.subtle
    .digest('SHA-256', data)
    .then((buffer) => {
      const bytes = Array.from(new Uint8Array(buffer));
      return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
    });
}

function hmacSha256Hex(key: CryptoKey | string, message: string): Promise<string> {
  return crypto.subtle
    .importKey(
      'raw',
      typeof key === 'string'
        ? new TextEncoder().encode(key)
        : (key as CryptoKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    .then((importedKey) =>
      crypto.subtle.sign(
        'HMAC',
        importedKey,
        new TextEncoder().encode(message)
      )
    )
    .then((buffer) => {
      const bytes = Array.from(new Uint8Array(buffer));
      return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
    });
}

function toUTCDateString(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 生成 TC3-HMAC-SHA256 签名 Authorization 头
 */
async function buildAuthorization({
  secretId,
  secretKey,
  service,
  host,
  action,
  timestamp,
  payload,
}: {
  secretId: string;
  secretKey: string;
  service: string;
  host: string;
  action: string;
  timestamp: number;
  payload: string;
}) {
  const date = toUTCDateString(timestamp);
  const contentType = 'application/json; charset=utf-8';

  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const hashedPayload = await sha256Hex(payload);

  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n');

  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedCanonicalRequest = await sha256Hex(canonicalRequest);
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    hashedCanonicalRequest,
  ].join('\n');

  const secretDate = await hmacSha256Hex(`TC3${secretKey}`, date);
  const secretService = await hmacSha256Hex(secretDate, service);
  const secretSigning = await hmacSha256Hex(secretService, 'tc3_request');
  const signature = await hmacSha256Hex(secretSigning, stringToSign);

  const authorization = [
    'TC3-HMAC-SHA256 ',
    `Credential=${secretId}/${credentialScope}, `,
    `SignedHeaders=${signedHeaders}, `,
    `Signature=${signature}`,
  ].join('');

  return {
    authorization,
    contentType,
    host,
  };
}

/**
 * 调用腾讯云 API（带 TC3 签名）
 */
async function callTencentCloud({
  secretId,
  secretKey,
  action,
  payload,
}: {
  secretId: string;
  secretKey: string;
  action: string;
  payload: Record<string, unknown>;
}) {
  const normalizedSecretId = secretId.trim();
  const normalizedSecretKey = secretKey.trim();
  if (!normalizedSecretId || !normalizedSecretKey) {
    throw new Error('缺少腾讯云 SecretId / SecretKey，请在设置中填写。');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(payload);

  const { authorization, contentType, host } = await buildAuthorization({
    secretId: normalizedSecretId,
    secretKey: normalizedSecretKey,
    service: 'mps',
    host: TENCENT_MPS_HOST,
    action,
    timestamp,
    payload: body,
  });

  const response = await fetch(`https://${TENCENT_MPS_HOST}`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': contentType,
      Host: host,
      'X-TC-Action': action,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': TENCENT_MPS_VERSION,
    },
    body,
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      json?.Response?.Error?.Message ||
      `腾讯云请求失败，状态码 ${response.status}`;
    throw new Error(message);
  }

  if (json?.Response?.Error) {
    throw new Error(json.Response.Error.Message || '腾讯云返回错误');
  }

  return json?.Response ?? {};
}

/**
 * 发起 AI 换装任务
 * @param modelUrl 模特图 URL（穿衣服的人）
 * @param garmentUrl 服饰图 URL（要穿的衣服）
 */
export async function createTencentTryOn({
  secretId,
  secretKey,
  modelUrl,
  garmentUrl,
  model,
  prompt,
  resolution,
}: {
  secretId: string;
  secretKey: string;
  modelUrl: string;
  garmentUrl: string;
  model: string;
  prompt?: string;
  resolution?: string;
}) {
  if (!modelUrl.trim() || !garmentUrl.trim()) {
    throw new Error('换装需要模特图和服饰图各一张。');
  }

  if (
    !/^https?:\/\//i.test(modelUrl.trim()) ||
    !/^https?:\/\//i.test(garmentUrl.trim())
  ) {
    throw new Error(
      '腾讯云换装要求模特图与服饰图均为公网可访问的 https URL。本地存储 (/uploads) 生成的相对 URL 无法被腾讯云服务器访问，请改用 S3 存储或将图床切换为公网域名（设置 NEXT_PUBLIC_APP_URL）。'
    );
  }

  const payload: Record<string, unknown> = {
    ImageTask: {
      AiTryOnConfig: {
        InputImage: {
          Type: 'URL',
          UrlInputInfo: { Url: modelUrl.trim() },
        },
        Model: model.trim() || 'WAND-tryon-1.0',
        Resolution: resolution || '1K',
        ResultConfig: { Type: 'Base64' },
        ...(prompt?.trim() ? { Prompt: prompt.trim() } : {}),
      },
    },
    AddOnParameter: {
      ImageSet: [
        {
          Type: 'garment',
          Image: {
            Type: 'URL',
            UrlInputInfo: { Url: garmentUrl.trim() },
          },
        },
      ],
    },
  };

  const response = await callTencentCloud({
    secretId,
    secretKey,
    action: 'ProcessImage',
    payload,
  });

  const taskId = response.TaskId ? String(response.TaskId) : '';
  if (!taskId) {
    throw new Error('腾讯云未返回任务 ID。');
  }

  return { taskId };
}

/**
 * 查询换装任务结果
 */
export type TencentTryOnResult = {
  status: 'success' | 'error' | 'running';
  outputMediaUrl: string;
  errorMessage?: string;
};

export async function queryTencentTryOn({
  secretId,
  secretKey,
  taskId,
}: {
  secretId: string;
  secretKey: string;
  taskId: string;
}): Promise<TencentTryOnResult> {
  const response = await callTencentCloud({
    secretId,
    secretKey,
    action: 'DescribeImageTaskDetail',
    payload: { TaskId: taskId },
  });

  const status = response.Status ? String(response.Status) : '';
  const resultSet = Array.isArray(response.ImageProcessTaskResultSet)
    ? response.ImageProcessTaskResultSet
    : [];

  const firstResult = resultSet[0] ?? {};
  const subStatus = firstResult.Status ? String(firstResult.Status) : status;
  const outputUrl = firstResult.Output?.SignedUrl
    ? String(firstResult.Output.SignedUrl)
    : '';
  const resultImage = firstResult.Output?.ResultImage
    ? String(firstResult.Output.ResultImage)
    : '';
  const errorMessage =
    firstResult.Output?.ErrorMessage
      ? String(firstResult.Output.ErrorMessage)
      : response.Message
        ? String(response.Message)
        : '';

  if (subStatus === 'FINISH' || status === 'FINISH') {
    if (outputUrl) {
      return { status: 'success', outputMediaUrl: outputUrl };
    }
    if (resultImage) {
      // base64 直接转 data URL，避免需要对外可达的存储
      const dataUrl = resultImage.startsWith('data:')
        ? resultImage
        : `data:image/jpeg;base64,${resultImage}`;
      return { status: 'success', outputMediaUrl: dataUrl };
    }
    return { status: 'error', outputMediaUrl: '', errorMessage: '腾讯云任务完成但未返回图像' };
  }

  if (subStatus === 'FAILED' || status === 'FAILED') {
    return {
      status: 'error',
      outputMediaUrl: '',
      errorMessage: errorMessage || '腾讯云换装任务失败',
    };
  }

  return { status: 'running', outputMediaUrl: '' };
}
