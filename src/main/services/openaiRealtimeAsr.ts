import WebSocket from 'ws';
import type { ModelEndpointConfig } from '../../shared/types';

export interface RealtimeSession {
  sendPcm: (pcm: Buffer) => void;
  close: () => void;
}

export interface RealtimeCallbacks {
  onTranscript: (text: string, isFinal: boolean) => void;
  onError: (message: string) => void;
  onOpen?: () => void;
}

interface RealtimeEvent {
  type?: string;
  delta?: string;
  transcript?: string;
  error?: {
    message?: string;
  };
}

export async function startRealtimeTranscription(
  config: ModelEndpointConfig,
  language: string,
  callbacks: RealtimeCallbacks
): Promise<RealtimeSession> {
  const socket = await openSocket(config);
  let closedByClient = false;

  const onMessage = (data: WebSocket.RawData) => {
    try {
      const event = JSON.parse(rawDataToString(data)) as RealtimeEvent;

      if (event.type === 'conversation.item.input_audio_transcription.delta') {
        callbacks.onTranscript(event.delta ?? '', false);
        return;
      }

      if (event.type === 'conversation.item.input_audio_transcription.completed') {
        callbacks.onTranscript((event.transcript ?? '').trim(), true);
        return;
      }

      if (event.type === 'error') {
        callbacks.onError(event.error?.message ?? '实时转写错误');
      }
    } catch (error) {
      callbacks.onError(`实时转写响应解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const onError = (error: Error) => {
    if (!closedByClient) {
      callbacks.onError(error.message);
    }
  };

  const onClose = (code: number, reason: Buffer) => {
    if (closedByClient || code === 1000) {
      return;
    }

    const detail = reason.length > 0 ? `：${reason.toString('utf8')}` : '';
    callbacks.onError(`实时转写连接已关闭（${code}）${detail}`);
  };

  socket.on('message', onMessage);
  socket.on('error', onError);
  socket.on('close', onClose);

  socket.send(JSON.stringify(buildSessionUpdate(config, language)));
  callbacks.onOpen?.();

  return {
    sendPcm(pcm: Buffer) {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      socket.send(
        JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: pcm.toString('base64')
        }),
        (error) => {
          if (error && !closedByClient) {
            callbacks.onError(`实时转写音频发送失败：${error.message}`);
          }
        }
      );
    },
    close() {
      closedByClient = true;
      socket.off('message', onMessage);
      socket.off('error', onError);
      socket.off('close', onClose);

      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }
  };
}

function openSocket(config: ModelEndpointConfig): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(toRealtimeWsUrl(config.baseURL), {
      headers: {
        Authorization: `Bearer ${config.apiKey.trim()}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      socket.off('unexpected-response', onUnexpectedResponse);
      socket.off('open', onOpen);
      socket.off('error', onError);
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      socket.terminate();
      reject(error);
    };

    const timer = setTimeout(() => {
      fail(new Error('OpenAI Realtime 转写连接超时。'));
    }, 10_000);

    const onUnexpectedResponse = (_request: unknown, response: { statusCode?: number; statusMessage?: string; resume: () => void; destroy: () => void }) => {
      const statusCode = response.statusCode ?? 0;
      const statusMessage = response.statusMessage || '';
      response.resume();
      response.destroy();
      fail(new Error(`OpenAI Realtime 转写建连失败：HTTP ${statusCode} ${statusMessage}`.trim()));
    };

    const onOpen = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(socket);
    };

    const onError = (error: Error) => {
      fail(error);
    };

    socket.once('unexpected-response', onUnexpectedResponse);
    socket.once('open', onOpen);
    socket.once('error', onError);
  });
}

function toRealtimeWsUrl(baseURL: string): string {
  const trimmed = (baseURL || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
  const wsBase = trimmed.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  return `${wsBase}/realtime?intent=transcription`;
}

function buildSessionUpdate(config: ModelEndpointConfig, language: string): Record<string, unknown> {
  const normalizedLanguage = language.trim();
  const prompt =
    !normalizedLanguage || normalizedLanguage.toLowerCase().startsWith('zh')
      ? '以下是一段中文技术面试对话。'
      : 'The following is a technical job interview conversation.';
  const inputAudioTranscription: Record<string, string> = {
    model: config.model.trim() || 'gpt-4o-transcribe',
    prompt
  };

  if (normalizedLanguage) {
    inputAudioTranscription.language = normalizedLanguage;
  }

  return {
    type: 'transcription_session.update',
    session: {
      input_audio_format: 'pcm16',
      input_audio_transcription: inputAudioTranscription,
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500
      },
      input_audio_noise_reduction: {
        type: 'near_field'
      }
    }
  };
}

function rawDataToString(data: WebSocket.RawData): string {
  if (typeof data === 'string') {
    return data;
  }

  if (Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }

  return Buffer.from(data).toString('utf8');
}
