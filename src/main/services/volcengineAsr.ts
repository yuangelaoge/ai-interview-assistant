import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AudioChunkPayload, VolcengineAsrConfig } from '../../shared/types';

const execFileAsync = promisify(execFile);
const defaultPollTimeoutMs = 30_000;
const pollIntervalMs = 1_500;
const terminalOk = new Set(['COMPLETED']);
const terminalFail = new Set(['FAILED', 'TIMEOUT']);

interface LasUploadResponse {
  presigned_url?: string;
  url?: string;
}

interface LasTaskResponse {
  metadata?: {
    task_id?: string;
    task_status?: string;
    business_code?: string;
    error_msg?: string;
    request_id?: string;
  };
  data?: {
    result?: {
      text?: string;
      utterances?: Array<{ text?: string }>;
    };
  };
}

export async function transcribeWithVolcengineAucFlash(
  config: VolcengineAsrConfig,
  payload: AudioChunkPayload
): Promise<string> {
  validateConfig(config);

  const audioPath = path.join(os.tmpdir(), `interview-las-${Date.now()}.${getAudioFormat(payload.mimeType)}`);
  await fs.promises.writeFile(audioPath, Buffer.from(payload.data));

  try {
    const upload = await uploadAudioFile(config, audioPath);
    const audioUrl = upload.presigned_url || upload.url;

    if (!audioUrl) {
      throw new Error('LAS 文件上传成功，但返回结果里没有 presigned_url。');
    }

    const taskId = await submitTask(config, audioUrl, getAudioFormat(payload.mimeType));
    const result = await pollTask(config, taskId);
    return extractText(result);
  } finally {
    await fs.promises.rm(audioPath, { force: true });
  }
}

async function uploadAudioFile(config: VolcengineAsrConfig, audioPath: string): Promise<LasUploadResponse> {
  const region = getRegion(config);

  try {
    const { stdout } = await execFileAsync('lasutil', ['file-upload', audioPath], {
      env: {
        ...process.env,
        LAS_API_KEY: config.apiKey.trim(),
        LAS_REGION: region
      },
      timeout: 60_000,
      windowsHide: true
    });

    return parseJson(extractJson(stdout)) as LasUploadResponse;
  } catch (error) {
    if (isCommandMissing(error)) {
      throw new Error(
        '未找到 LAS 上传工具 lasutil。请先运行：python -m pip install --upgrade https://las-ai-cn-beijing-online.tos-cn-beijing.volces.com/operator_cards_serving/public/skills/sdk/las_sdk-0.2.0-py3-none-any.whl'
      );
    }

    throw new Error(`LAS 文件上传失败：${formatExecError(error)}`);
  }
}

async function submitTask(config: VolcengineAsrConfig, audioUrl: string, audioFormat: string): Promise<string> {
  const response = await requestLas(config, 'submit', {
    operator_id: getOperatorId(config),
    operator_version: getOperatorVersion(config),
    data: {
      audio: {
        url: audioUrl,
        format: audioFormat
      },
      request: {
        model_name: config.modelName.trim() || 'bigmodel'
      }
    }
  });

  const taskId = response.metadata?.task_id;
  if (!taskId) {
    throw new Error(`LAS ASR 提交成功但没有返回 task_id：${JSON.stringify(response)}`);
  }

  return taskId;
}

async function pollTask(config: VolcengineAsrConfig, taskId: string): Promise<LasTaskResponse> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < defaultPollTimeoutMs) {
    const response = await requestLas(config, 'poll', {
      operator_id: getOperatorId(config),
      operator_version: getOperatorVersion(config),
      task_id: taskId
    });
    const status = response.metadata?.task_status;

    if (status && terminalOk.has(status)) {
      return response;
    }

    if (status && terminalFail.has(status)) {
      if (isBenignEmptyAudioError(response.metadata?.error_msg)) {
        return response;
      }

      throw new Error(
        `LAS ASR 任务失败：${response.metadata?.business_code || status} ${response.metadata?.error_msg || ''}`.trim()
      );
    }

    await wait(pollIntervalMs);
  }

  throw new Error(`LAS ASR 轮询超时：task_id=${taskId}`);
}

async function requestLas(
  config: VolcengineAsrConfig,
  action: 'submit' | 'poll',
  body: Record<string, unknown>
): Promise<LasTaskResponse> {
  const response = await fetch(`${getApiBase(config)}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey.trim()}`
    },
    body: JSON.stringify(body)
  });

  const rawText = await response.text();
  const parsed = rawText ? (parseJson(rawText) as LasTaskResponse) : {};
  const metadata = parsed.metadata;

  if (!response.ok) {
    if (isBenignEmptyAudioError(metadata?.error_msg)) {
      return parsed;
    }

    throw new Error(
      `LAS ASR 请求失败：HTTP ${response.status}，${metadata?.business_code || 'Unknown'} ${metadata?.error_msg || rawText || response.statusText}`
    );
  }

  if (metadata?.business_code && metadata.business_code !== '0') {
    throw new Error(`LAS ASR 返回错误：${metadata.business_code} ${metadata.error_msg || ''}`.trim());
  }

  return parsed;
}

function validateConfig(config: VolcengineAsrConfig): void {
  if (!config.endpoint.trim()) {
    throw new Error('缺少 LAS ASR Base URL，请先在设置中配置。');
  }

  if (!config.apiKey.trim()) {
    throw new Error('缺少 LAS API Key。请填写 LAS 控制台“资源管理 > API Key 管理”创建的 API Key。');
  }

  if (!getOperatorId(config)) {
    throw new Error('缺少 LAS ASR operatorId，请先在设置中配置。');
  }
}

function getApiBase(config: VolcengineAsrConfig): string {
  const endpoint = config.endpoint.trim().replace(/\/+$/, '');

  if (endpoint.endsWith('/api/v1')) {
    return endpoint;
  }

  if (endpoint.endsWith('/submit') || endpoint.endsWith('/poll')) {
    return endpoint.replace(/\/(submit|poll)$/, '');
  }

  return `${endpoint}/api/v1`;
}

function getRegion(config: VolcengineAsrConfig): string {
  if (config.region?.trim()) {
    return config.region.trim();
  }

  const matched = config.endpoint.match(/operator\.las\.([^.]+)\.volces\.com/);
  return matched?.[1] || 'cn-beijing';
}

function getOperatorId(config: VolcengineAsrConfig): string {
  return config.resourceId.trim() || 'las_asr';
}

function getOperatorVersion(config: VolcengineAsrConfig): string {
  return config.operatorVersion?.trim() || 'v2';
}

function getAudioFormat(mimeType: string): string {
  if (mimeType.includes('mp3') || mimeType.includes('mpeg')) {
    return 'mp3';
  }

  if (mimeType.includes('ogg')) {
    return 'ogg';
  }

  return 'wav';
}

function extractText(response: LasTaskResponse): string {
  const text =
    response.data?.result?.text?.trim() ||
    response.data?.result?.utterances
      ?.map((item) => item.text?.trim())
      .filter(Boolean)
      .join('');

  return text?.trim() ?? '';
}

function extractJson(output: string): string {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`LAS 工具没有返回 JSON：${output.slice(0, 240)}`);
  }

  return output.slice(start, end + 1);
}

function parseJson(rawText: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error(`LAS ASR 返回了非 JSON 内容：${rawText.slice(0, 240)}`);
  }
}

function isCommandMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ENOENT';
}

function formatExecError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const maybeError = error as { message?: string; stdout?: string; stderr?: string };
    return (maybeError.stderr || maybeError.stdout || maybeError.message || '未知错误').trim();
  }

  return String(error);
}

function isBenignEmptyAudioError(message: string | undefined): boolean {
  return /audio is mute|empty audio|silent audio|静音|空音频/i.test(message || '');
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
