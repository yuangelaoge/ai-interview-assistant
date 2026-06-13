import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import OpenAI from 'openai';
import type { AudioChunkPayload, ModelEndpointConfig } from '../../shared/types';

type ChatCompletionChoiceLike = {
  message?: {
    content?: unknown;
  };
  delta?: {
    content?: unknown;
  };
};

type ChatCompletionResponseLike = {
  choices?: ChatCompletionChoiceLike[];
};

export function createClient(config: ModelEndpointConfig): OpenAI {
  if (!config.apiKey.trim()) {
    throw new Error('缺少 API key，请先在设置中配置。');
  }

  if (!config.baseURL.trim()) {
    throw new Error('缺少 API baseURL，请先在设置中配置。');
  }

  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL
  });
}

export async function transcribeWithOpenAiCompatibleApi(
  config: ModelEndpointConfig,
  payload: AudioChunkPayload
): Promise<string> {
  const client = createClient(config);
  const extension = payload.mimeType.includes('webm') ? 'webm' : 'wav';
  const audioPath = path.join(os.tmpdir(), `interview-audio-${Date.now()}.${extension}`);
  const buffer = Buffer.from(payload.data);

  await fs.promises.writeFile(audioPath, buffer);

  try {
    const result = await client.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: config.model,
      response_format: 'json'
    });

    return result.text?.trim() ?? '';
  } finally {
    await fs.promises.rm(audioPath, { force: true });
  }
}

export async function chatCompletion(
  config: ModelEndpointConfig,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  options: {
    temperature?: number;
    maxTokens?: number;
    thinking?: 'enabled' | 'disabled';
  } = {}
): Promise<string> {
  const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
    extra_body?: Record<string, unknown>;
    thinking?: {
      type: 'enabled' | 'disabled';
    };
  } = {
    model: config.model,
    messages,
    max_tokens: options.maxTokens
  };

  if (options.thinking) {
    request.thinking = {
      type: options.thinking
    };
  } else {
    request.temperature = options.temperature ?? 0.3;
  }

  const result = await createClient(config).chat.completions.create(request);

  const choices = getChoices(result);
  if (choices.length === 0) {
    const fallbackConfig = withV1BaseURL(config);
    if (fallbackConfig) {
      const fallbackResult = await createClient(fallbackConfig).chat.completions.create(request);
      const fallbackChoices = getChoices(fallbackResult);
      if (fallbackChoices.length > 0) {
        return contentToText(fallbackChoices[0]?.message?.content).trim();
      }

      throwUnexpectedChatResponseError('模型接口返回格式异常：未找到 choices 数组。', fallbackConfig, fallbackResult);
    }

    throwUnexpectedChatResponseError('模型接口返回格式异常：未找到 choices 数组。', config, result);
  }

  return contentToText(choices[0]?.message?.content).trim();
}

export async function streamChatCompletion(
  config: ModelEndpointConfig,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  onDelta: (delta: string) => void,
  options: {
    temperature?: number;
    maxTokens?: number;
    thinking?: 'enabled' | 'disabled';
  } = {}
): Promise<string> {
  const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming & {
    extra_body?: Record<string, unknown>;
    thinking?: {
      type: 'enabled' | 'disabled';
    };
  } = {
    model: config.model,
    messages,
    max_tokens: options.maxTokens,
    stream: true
  };

  if (options.thinking) {
    request.thinking = {
      type: options.thinking
    };
  } else {
    request.temperature = options.temperature ?? 0.3;
  }

  const fallbackConfig = withV1BaseURL(config);
  const answer = await readChatCompletionStream(config, request, onDelta);
  if (answer || !fallbackConfig) {
    return answer;
  }

  return readChatCompletionStream(fallbackConfig, request, onDelta);
}

async function readChatCompletionStream(
  config: ModelEndpointConfig,
  request: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
  onDelta: (delta: string) => void
): Promise<string> {
  const stream = await createClient(config).chat.completions.create(request);
  let answer = '';

  for await (const chunk of stream) {
    const choices = getChoices(chunk);
    if (choices.length === 0) {
      const errorMessage = extractResponseError(chunk);
      if (errorMessage) {
        throwUnexpectedChatResponseError('模型流式接口返回错误。', config, chunk);
      }
      continue;
    }

    const delta = contentToText(choices[0]?.delta?.content);
    if (!delta) {
      continue;
    }

    answer += delta;
    onDelta(delta);
  }

  return answer.trim();
}

function withV1BaseURL(config: ModelEndpointConfig): ModelEndpointConfig | undefined {
  const baseURL = config.baseURL.trim();
  if (!baseURL || /\/v1\/?$/i.test(baseURL)) {
    return undefined;
  }

  try {
    const url = new URL(baseURL);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/v1`;
    return {
      ...config,
      baseURL: url.toString().replace(/\/$/, '')
    };
  } catch {
    return undefined;
  }
}

function getChoices(result: unknown): ChatCompletionChoiceLike[] {
  if (!isRecord(result)) {
    return [];
  }

  const choices = (result as ChatCompletionResponseLike).choices;
  return Array.isArray(choices) ? choices : [];
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      if (!isRecord(part)) {
        return '';
      }

      if (typeof part.text === 'string') {
        return part.text;
      }

      if (isRecord(part.text) && typeof part.text.value === 'string') {
        return part.text.value;
      }

      return '';
    })
    .join('');
}

function throwUnexpectedChatResponseError(message: string, config: ModelEndpointConfig, response: unknown): never {
  const detail = extractResponseError(response) ?? summarizeResponse(response);
  const suffix = detail ? ` 服务端返回：${detail}` : '';
  throw new Error(`${message} baseURL=${config.baseURL}, model=${config.model}.${suffix}`);
}

function extractResponseError(response: unknown): string | undefined {
  if (!isRecord(response)) {
    return undefined;
  }

  const error = response.error;
  if (typeof error === 'string') {
    return error;
  }

  if (isRecord(error)) {
    const parts = [error.message, error.code, error.type]
      .filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
      .map(String);

    if (parts.length > 0) {
      return parts.join(' / ');
    }
  }

  if (typeof response.message === 'string') {
    return response.message;
  }

  return undefined;
}

function summarizeResponse(response: unknown): string | undefined {
  if (!isRecord(response)) {
    return undefined;
  }

  const keys = Object.keys(response).slice(0, 8);
  return keys.length > 0 ? `响应字段：${keys.join(', ')}` : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
