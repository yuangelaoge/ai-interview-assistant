import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import OpenAI from 'openai';
import type { AudioChunkPayload, ModelEndpointConfig } from '../../shared/types';

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
  const client = createClient(config);
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

  const result = await client.chat.completions.create(request);

  return result.choices[0]?.message?.content?.trim() ?? '';
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
  const client = createClient(config);
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

  const stream = await client.chat.completions.create(request);
  let answer = '';

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (!delta) {
      continue;
    }

    answer += delta;
    onDelta(delta);
  }

  return answer.trim();
}
