import {
  createCyberbaraGeneration,
  queryCyberbaraTask,
  runCyberbaraText,
} from '@/lib/cyberbara';
import { runDeepseekText } from '@/lib/deepseek';
import {
  createMinimaxImageGeneration,
  createMinimaxVideoGeneration,
  queryMinimaxImageTask,
  queryMinimaxVideoTask,
} from '@/lib/minimax';
import {
  createTencentTryOn,
  queryTencentTryOn,
} from '@/lib/tencent-cloud';
import type { ProviderSettings } from '@/lib/types';
import {
  buildCanvasNodeTaskDescriptor,
  type CanvasMediaTaskDescriptor,
  type CanvasTextTaskDescriptor,
} from '@/shared/lib/canvas/execution';
import {
  getCanvasNodeById,
  normalizeCanvasNodeData,
  type CanvasNodeMedia,
  type CanvasNodePatch,
} from '@/shared/lib/canvas/types';
import {
  applyLocalCanvasNodePatch,
  createLocalCanvasRun,
  findLocalCanvasDocumentById,
  findLocalCanvasRun,
  updateLocalCanvasRun,
} from '@/shared/models/local-canvas-store';

function nowIso() {
  return new Date().toISOString();
}

function ensureProviderKeys({
  settings,
  providers,
}: {
  settings: ProviderSettings;
  providers: string[];
}) {
  const missingKeys: string[] = [];

  if (providers.includes('cyberbara') && !settings.cyberbaraApiKey.trim()) {
    missingKeys.push('Cyberbara');
  }
  if (providers.includes('deepseek') && !settings.deepseekApiKey.trim()) {
    missingKeys.push('DeepSeek');
  }
  if (providers.includes('minimax') && !settings.minimaxApiKey.trim()) {
    missingKeys.push('MiniMax');
  }
  if (providers.includes('tencent-tryon')) {
    if (
      !settings.tencentSecretId.trim() ||
      !settings.tencentSecretKey.trim()
    ) {
      missingKeys.push('腾讯云 MPS');
    }
  }
  if (providers.includes('openrouter') && !settings.openrouterApiKey.trim()) {
    missingKeys.push('OpenRouter');
  }
  if (providers.includes('replicate') && !settings.replicateApiToken.trim()) {
    missingKeys.push('Replicate');
  }

  if (missingKeys.length === 0) {
    return;
  }

  throw new Error(
    `缺少提供方 API Key：${missingKeys.join('、')}。请在 Settings 中填写后再运行。`
  );
}

function isDeepseekTextModel(model: string) {
  return model.trim().startsWith('deepseek');
}

function buildInputSummary(inputs: CanvasMediaTaskDescriptor['inputs'] | CanvasTextTaskDescriptor['inputs']) {
  return {
    textInputs: inputs.textInputs.length,
    imageInputs: inputs.imageInputs.map((item) => item.url),
    styleReferenceInputs: inputs.styleReferenceInputs.map((item) => item.url),
    omniReferenceInputs: inputs.omniReferenceInputs.map((item) => item.url),
    videoInputs: inputs.videoInputs.map((item) => item.url),
    audioInputs: inputs.audioInputs.map((item) => item.url),
  };
}

function createGeneratedMedia(url: string, nodeType: 'image' | 'video'): CanvasNodeMedia {
  return {
    url,
    source: 'generated',
    mimeType: nodeType === 'image' ? 'image/png' : 'video/mp4',
  };
}

function getPrimaryMediaInput(descriptor: CanvasMediaTaskDescriptor) {
  if (descriptor.inputs.videoInputs[0]?.url) {
    return {
      mediaUrl: descriptor.inputs.videoInputs[0].url,
      mediaKind: 'video' as const,
    };
  }

  if (descriptor.inputs.imageInputs[0]?.url) {
    return {
      mediaUrl: descriptor.inputs.imageInputs[0].url,
      mediaKind: 'image' as const,
    };
  }

  if (descriptor.inputs.styleReferenceInputs[0]?.url) {
    return {
      mediaUrl: descriptor.inputs.styleReferenceInputs[0].url,
      mediaKind: 'image' as const,
    };
  }

  if (descriptor.inputs.omniReferenceInputs[0]?.url) {
    return {
      mediaUrl: descriptor.inputs.omniReferenceInputs[0].url,
      mediaKind: 'image' as const,
    };
  }

  return {
    mediaUrl: null,
    mediaKind: null,
  };
}

export async function executeLocalCanvasNode({
  canvasId,
  nodeId,
  revision,
  triggerType,
  settings,
}: {
  canvasId: string;
  nodeId: string;
  revision: number;
  triggerType: 'manual' | 'retry';
  settings: ProviderSettings;
}) {
  const canvas = await findLocalCanvasDocumentById(canvasId);
  if (!canvas) {
    throw new Error('canvas not found');
  }

  if (canvas.revision !== revision) {
    throw new Error('revision_conflict');
  }

  const node = getCanvasNodeById(canvas.graph, nodeId);
  if (!node) {
    throw new Error('node_not_found');
  }

  const descriptor = buildCanvasNodeTaskDescriptor(canvas.graph, nodeId);
  if ('kind' in descriptor === false) {
    throw new Error(descriptor.message);
  }

  const requiredProviders =
    descriptor.kind === 'text'
      ? [isDeepseekTextModel(descriptor.model) ? 'deepseek' : 'cyberbara']
      : (() => {
          if (descriptor.provider === 'minimax') return ['minimax'];
          if (descriptor.provider === 'tencent-tryon') return ['tencent-tryon'];
          return ['cyberbara'];
        })();
  ensureProviderKeys({ settings, providers: requiredProviders });

  const nodeData = normalizeCanvasNodeData(node.type, node.data);
  const resolvedProvider =
    descriptor.kind === 'media'
      ? descriptor.provider
      : isDeepseekTextModel(descriptor.model)
        ? 'deepseek'
        : 'cyberbara';
  const run = await createLocalCanvasRun({
    canvasId,
    userId: 'local-user',
    nodeId,
    nodeType: nodeData.nodeType,
    status: 'running',
    triggerType,
    scene: descriptor.scene,
    provider: resolvedProvider,
    model: descriptor.model,
    prompt: descriptor.prompt,
    aiTaskId: null,
    costCredits: 0,
    inputSummary: buildInputSummary(descriptor.inputs),
    requestPayload:
      descriptor.kind === 'text'
        ? {
            model: descriptor.model,
            prompt: descriptor.prompt,
          }
        : {
            model: descriptor.publicModel,
            prompt: descriptor.prompt,
            options: descriptor.options,
            scene: descriptor.scene,
          },
    responsePayload: null,
    outputAsset: null,
    errorCode: null,
    errorMessage: null,
    finishedAt: null,
  });

  if (descriptor.kind === 'text') {
    const result = isDeepseekTextModel(descriptor.model)
      ? await runDeepseekText({
          apiKey: settings.deepseekApiKey,
          model: descriptor.model,
          prompt: descriptor.userMessage,
          contextText: [],
        })
      : await runCyberbaraText({
          apiKey: settings.cyberbaraApiKey,
          model: descriptor.model,
          prompt: descriptor.userMessage,
          contextText: [],
          imageUrls: descriptor.inputs.imageInputs.map((item) => item.url),
        });

    const completedAt = nowIso();
    await updateLocalCanvasRun({
      canvasId,
      runId: run.id,
      status: 'success',
      responsePayload:
        result.payload && typeof result.payload === 'object'
          ? (result.payload as Record<string, unknown>)
          : null,
      finishedAt: completedAt,
    });

    const nodePatch: CanvasNodePatch = {
      nodeId,
      status: 'success',
      errorMessage: null,
      lastRunId: run.id,
      lastCompletedAt: completedAt,
      lastScene: descriptor.scene,
      costCredits: 0,
      plainText: result.text,
    };
    const updatedCanvas = await applyLocalCanvasNodePatch({ canvasId, patch: nodePatch });
    if (!updatedCanvas) {
      throw new Error('canvas patch failed');
    }

    const completedRun = await findLocalCanvasRun({ canvasId, runId: run.id });
    return {
      run: completedRun || { ...run, status: 'success', finishedAt: completedAt },
      nodePatch,
      revision: updatedCanvas.revision,
    };
  }

  if (nodeData.nodeType === 'audio') {
    throw new Error('Audio generation is not wired into the local OSS shell yet.');
  }

  const mediaDescriptor = descriptor as CanvasMediaTaskDescriptor;
  const { mediaUrl, mediaKind } = getPrimaryMediaInput(mediaDescriptor);
  const isMinimax = mediaDescriptor.provider === 'minimax';
  const isTencentTryOn = mediaDescriptor.provider === 'tencent-tryon';

  let result: {
    predictionId: string;
    status: 'success' | 'running' | 'error';
    outputMediaUrl: string;
  };

  if (isMinimax && nodeData.nodeType === 'image') {
    const aspectRatio =
      typeof mediaDescriptor.options.aspect_ratio === 'string'
        ? mediaDescriptor.options.aspect_ratio
        : '1:1';
    const resolution =
      typeof mediaDescriptor.options.resolution === 'string'
        ? mediaDescriptor.options.resolution
        : '1K';
    const created = await createMinimaxImageGeneration({
      apiKey: settings.minimaxApiKey,
      prompt: mediaDescriptor.prompt,
      aspectRatio,
      resolution,
      subjectReferenceUrl: mediaKind === 'image' ? mediaUrl : null,
    });
    const queried = await queryMinimaxImageTask({
      apiKey: settings.minimaxApiKey,
      taskId: created.taskId,
    });
    result = {
      predictionId: created.taskId,
      status: queried.status,
      outputMediaUrl: queried.outputMediaUrl,
    };
  } else if (isMinimax && nodeData.nodeType === 'video') {
    const duration =
      typeof mediaDescriptor.options.duration === 'string'
        ? mediaDescriptor.options.duration
        : '5';
    const resolution =
      typeof mediaDescriptor.options.resolution === 'string'
        ? mediaDescriptor.options.resolution
        : '768P';
    const created = await createMinimaxVideoGeneration({
      apiKey: settings.minimaxApiKey,
      prompt: mediaDescriptor.prompt,
      duration,
      resolution,
      firstFrameUrl: mediaKind === 'image' ? mediaUrl : null,
    });
    // MiniMax 视频生成耗时较长，创建后先返回 running，由轮询接口继续查询
    result = {
      predictionId: created.taskId,
      status: 'running',
      outputMediaUrl: '',
    };
  } else if (isTencentTryOn) {
    // 腾讯云换装：第一张输入图 = 模特图，第二张输入图 = 服饰图
    const modelUrl = mediaDescriptor.inputs.imageInputs[0]?.url ?? mediaUrl;
    const garmentUrl = mediaDescriptor.inputs.imageInputs[1]?.url ?? '';

    if (!garmentUrl) {
      throw new Error(
        '换装需要两张图片：第一张是模特图，第二张是服饰图。请再连接一张服饰图片。'
      );
    }

    const created = await createTencentTryOn({
      secretId: settings.tencentSecretId,
      secretKey: settings.tencentSecretKey,
      modelUrl,
      garmentUrl,
      model: mediaDescriptor.publicModel || 'WAND-tryon-1.0',
      prompt: mediaDescriptor.prompt || undefined,
    });
    // 换装耗时较长，创建后先返回 running，由轮询接口继续查询
    result = {
      predictionId: created.taskId,
      status: 'running',
      outputMediaUrl: '',
    };
  } else {
    result = await createCyberbaraGeneration({
      apiKey: settings.cyberbaraApiKey,
      baseUrl: settings.cyberbaraBaseUrl,
      nodeType: nodeData.nodeType === 'image' ? 'image' : 'video',
      model: mediaDescriptor.publicModel,
      prompt: mediaDescriptor.prompt,
      inputJson: JSON.stringify(mediaDescriptor.options),
      mediaUrl,
      mediaKind,
    });
  }

  const nodePatch: CanvasNodePatch = {
    nodeId,
    status: result.status === 'success' ? 'success' : 'running',
    errorMessage: null,
    lastRunId: run.id,
    lastCompletedAt: result.status === 'success' ? nowIso() : null,
    lastScene: mediaDescriptor.scene,
    costCredits: 0,
  };

  if (result.status === 'success' && result.outputMediaUrl) {
    const media = createGeneratedMedia(
      result.outputMediaUrl,
      nodeData.nodeType === 'image' ? 'image' : 'video'
    );
    if (nodeData.nodeType === 'image') {
      nodePatch.image = media;
      nodePatch.imageOutputs = [media];
      nodePatch.selectedImageIndex = 0;
    } else {
      nodePatch.video = media;
      nodePatch.videoHistory = [media];
      nodePatch.selectedVideoIndex = 0;
    }
  }

  await updateLocalCanvasRun({
    canvasId,
    runId: run.id,
    status: result.status === 'success' ? 'success' : 'running',
    aiTaskId: result.predictionId,
    responsePayload: {
      predictionId: result.predictionId,
      outputMediaUrl: result.outputMediaUrl,
    },
    outputAsset:
      result.status === 'success' && result.outputMediaUrl
        ? createGeneratedMedia(
            result.outputMediaUrl,
            nodeData.nodeType === 'image' ? 'image' : 'video'
          )
        : null,
    finishedAt: result.status === 'success' ? nowIso() : null,
  });

  const updatedCanvas = await applyLocalCanvasNodePatch({ canvasId, patch: nodePatch });
  if (!updatedCanvas) {
    throw new Error('canvas patch failed');
  }

  const currentRun = await findLocalCanvasRun({ canvasId, runId: run.id });
  return {
    run: currentRun || run,
    nodePatch,
    revision: updatedCanvas.revision,
  };
}

export async function queryLocalCanvasNodeRun({
  canvasId,
  runId,
  settings,
}: {
  canvasId: string;
  runId: string;
  settings: ProviderSettings;
}) {
  const run = await findLocalCanvasRun({ canvasId, runId });
  if (!run) {
    throw new Error('run not found');
  }

  if (
    run.status === 'success' ||
    run.status === 'failed' ||
    run.status === 'canceled' ||
    !run.aiTaskId
  ) {
    return {
      run,
      nodePatch: null,
      revision: null,
    };
  }

  const isMinimax = run.provider === 'minimax';
  const isTencentTryOn = run.provider === 'tencent-tryon';
  ensureProviderKeys({
    settings,
    providers: isMinimax
      ? ['minimax']
      : isTencentTryOn
        ? ['tencent-tryon']
        : ['cyberbara'],
  });
  const task = isMinimax
    ? run.nodeType === 'image'
      ? await queryMinimaxImageTask({
          apiKey: settings.minimaxApiKey,
          taskId: run.aiTaskId,
        })
      : await queryMinimaxVideoTask({
          apiKey: settings.minimaxApiKey,
          taskId: run.aiTaskId,
        })
    : isTencentTryOn
      ? await queryTencentTryOn({
          secretId: settings.tencentSecretId,
          secretKey: settings.tencentSecretKey,
          taskId: run.aiTaskId,
        })
      : await queryCyberbaraTask({
          apiKey: settings.cyberbaraApiKey,
          baseUrl: settings.cyberbaraBaseUrl,
          taskId: run.aiTaskId,
        });

  if (task.status === 'running') {
    const nextRun = await updateLocalCanvasRun({
      canvasId,
      runId,
      status: 'running',
      responsePayload: {
        predictionId: task.predictionId,
        outputMediaUrl: task.outputMediaUrl,
      },
    });

    return {
      run: nextRun || run,
      nodePatch: null,
      revision: null,
    };
  }

  if (task.status === 'error') {
    const completedAt = nowIso();
    const reason =
      (task as { errorMessage?: string }).errorMessage?.trim() ||
      'Generation failed';
    const nextRun = await updateLocalCanvasRun({
      canvasId,
      runId,
      status: 'failed',
      errorCode: 'generation_failed',
      errorMessage: reason,
      finishedAt: completedAt,
      responsePayload: {
        predictionId: task.predictionId,
      },
    });
    const nodePatch: CanvasNodePatch = {
      nodeId: run.nodeId,
      status: 'error',
      errorMessage: reason,
      lastRunId: run.id,
      lastCompletedAt: completedAt,
      lastScene: run.scene,
      costCredits: 0,
    };
    const updatedCanvas = await applyLocalCanvasNodePatch({ canvasId, patch: nodePatch });

    return {
      run: nextRun || run,
      nodePatch,
      revision: updatedCanvas?.revision ?? null,
    };
  }

  const completedAt = nowIso();
  const media = createGeneratedMedia(
    task.outputMediaUrl,
    run.nodeType === 'image' ? 'image' : 'video'
  );
  const nextRun = await updateLocalCanvasRun({
    canvasId,
    runId,
    status: 'success',
    outputAsset: media,
    finishedAt: completedAt,
    responsePayload: {
      predictionId: task.predictionId,
      outputMediaUrl: task.outputMediaUrl,
    },
  });

  const nodePatch: CanvasNodePatch = {
    nodeId: run.nodeId,
    status: 'success',
    errorMessage: null,
    lastRunId: run.id,
    lastCompletedAt: completedAt,
    lastScene: run.scene,
    costCredits: 0,
  };

  if (run.nodeType === 'image') {
    nodePatch.image = media;
    nodePatch.imageOutputs = [media];
    nodePatch.selectedImageIndex = 0;
  } else if (run.nodeType === 'video') {
    nodePatch.video = media;
    nodePatch.videoHistory = [media];
    nodePatch.selectedVideoIndex = 0;
  }

  const updatedCanvas = await applyLocalCanvasNodePatch({ canvasId, patch: nodePatch });

  return {
    run: nextRun || run,
    nodePatch,
    revision: updatedCanvas?.revision ?? null,
  };
}
