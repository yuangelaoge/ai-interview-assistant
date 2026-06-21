import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { z } from 'zod';
import { defaultConfig } from '../../shared/defaultConfig';
import type { AppConfig } from '../../shared/types';

const endpointSchema = z.object({
  baseURL: z.string(),
  apiKey: z.string(),
  model: z.string()
});

const asrSchema = z.object({
  provider: z.enum(['openai-compatible', 'volcengine-auc-flash', 'volcengine-sauc-stream', 'macos-speech', 'openai-realtime']),
  language: z.string(),
  openai: endpointSchema,
  openaiRealtime: endpointSchema,
  volcengine: z.object({
    endpoint: z.string(),
    apiKey: z.string(),
    appKey: z.string(),
    accessKey: z.string(),
    resourceId: z.string(),
    modelName: z.string(),
    operatorVersion: z.string().optional(),
    region: z.string().optional()
  }),
  volcengineSauc: z.object({
    endpoint: z.string(),
    apiKey: z.string(),
    appKey: z.string(),
    accessKey: z.string(),
    resourceId: z.string(),
    modelName: z.string(),
    enableNonstream: z.boolean()
  })
});

const knowledgeBaseSchema = z.object({
  enabled: z.boolean(),
  dirPath: z.string(),
  embedding: endpointSchema,
  topK: z.number()
});

const configSchema = z.object({
  asr: asrSchema,
  audioInputDeviceId: z.string(),
  fastModel: endpointSchema,
  deepModel: endpointSchema,
  screenshotModel: endpointSchema,
  knowledgeBase: knowledgeBaseSchema,
  fastAnswerMode: z.enum(['zero-context', 'context']),
  deepAnswerMode: z.enum(['context', 'codebase']),
  screenshotMode: z.enum(['general', 'acm']),
  answerLanguage: z.enum(['auto', 'zh', 'en', 'ja', 'ko']),
  shallowDocsPath: z.string(),
  deepContextPath: z.string(),
  codeWorkspacePath: z.string(),
  confirmHotkey: z.string(),
  autoAnswer: z.boolean(),
  screenshotHotkey: z.string(),
  screenshotTripleClick: z.boolean()
});

const configFileName = 'interview-assistant-config.json';

function getConfigPath(): string {
  return path.join(app.getPath('userData'), configFileName);
}

export function getConfig(): AppConfig {
  const stored = readStoredConfig();
  const current = {
    ...defaultConfig,
    ...stored,
    asr: {
      ...defaultConfig.asr,
      ...stored.asr,
      provider: stored.asr?.provider ?? defaultConfig.asr.provider,
      language: stored.asr?.language ?? defaultConfig.asr.language,
      openai: withEndpointEnv(
        { ...defaultConfig.asr.openai, ...stored.asr?.openai },
        {
          baseURL: 'AI_INTERVIEW_ASR_OPENAI_BASE_URL',
          apiKey: 'AI_INTERVIEW_ASR_OPENAI_API_KEY',
          model: 'AI_INTERVIEW_ASR_OPENAI_MODEL'
        }
      ),
      openaiRealtime: withEndpointEnv(
        { ...defaultConfig.asr.openaiRealtime, ...stored.asr?.openaiRealtime },
        {
          baseURL: 'AI_INTERVIEW_OPENAI_REALTIME_BASE_URL',
          apiKey: 'AI_INTERVIEW_OPENAI_REALTIME_API_KEY',
          model: 'AI_INTERVIEW_OPENAI_REALTIME_MODEL'
        }
      ),
      volcengine: {
        ...defaultConfig.asr.volcengine,
        ...stored.asr?.volcengine,
        endpoint: stored.asr?.volcengine?.endpoint || envString('AI_INTERVIEW_VOLCENGINE_LAS_ENDPOINT') || defaultConfig.asr.volcengine.endpoint,
        apiKey: stored.asr?.volcengine?.apiKey || envString('AI_INTERVIEW_VOLCENGINE_LAS_API_KEY'),
        appKey: stored.asr?.volcengine?.appKey || envString('AI_INTERVIEW_VOLCENGINE_LAS_APP_KEY'),
        accessKey: stored.asr?.volcengine?.accessKey || envString('AI_INTERVIEW_VOLCENGINE_LAS_ACCESS_KEY'),
        resourceId:
          stored.asr?.volcengine?.resourceId ||
          envString('AI_INTERVIEW_VOLCENGINE_LAS_RESOURCE_ID') ||
          defaultConfig.asr.volcengine.resourceId,
        modelName:
          stored.asr?.volcengine?.modelName ||
          envString('AI_INTERVIEW_VOLCENGINE_LAS_MODEL_NAME') ||
          defaultConfig.asr.volcengine.modelName
      },
      volcengineSauc: {
        ...defaultConfig.asr.volcengineSauc,
        ...stored.asr?.volcengineSauc,
        endpoint:
          stored.asr?.volcengineSauc?.endpoint ||
          envString('AI_INTERVIEW_VOLCENGINE_SAUC_ENDPOINT') ||
          defaultConfig.asr.volcengineSauc.endpoint,
        apiKey: stored.asr?.volcengineSauc?.apiKey || envString('AI_INTERVIEW_VOLCENGINE_SAUC_API_KEY'),
        appKey: stored.asr?.volcengineSauc?.appKey || envString('AI_INTERVIEW_VOLCENGINE_SAUC_APP_KEY'),
        accessKey: stored.asr?.volcengineSauc?.accessKey || envString('AI_INTERVIEW_VOLCENGINE_SAUC_ACCESS_KEY'),
        resourceId:
          stored.asr?.volcengineSauc?.resourceId ||
          envString('AI_INTERVIEW_VOLCENGINE_SAUC_RESOURCE_ID') ||
          defaultConfig.asr.volcengineSauc.resourceId,
        modelName:
          stored.asr?.volcengineSauc?.modelName ||
          envString('AI_INTERVIEW_VOLCENGINE_SAUC_MODEL_NAME') ||
          defaultConfig.asr.volcengineSauc.modelName
      }
    },
    fastModel: withEndpointEnv(
      { ...defaultConfig.fastModel, ...stored.fastModel },
      {
        baseURL: 'AI_INTERVIEW_FAST_MODEL_BASE_URL',
        apiKey: 'AI_INTERVIEW_FAST_MODEL_API_KEY',
        model: 'AI_INTERVIEW_FAST_MODEL_NAME'
      }
    ),
    deepModel: withEndpointEnv(
      { ...defaultConfig.deepModel, ...stored.deepModel },
      {
        baseURL: 'AI_INTERVIEW_DEEP_MODEL_BASE_URL',
        apiKey: 'AI_INTERVIEW_DEEP_MODEL_API_KEY',
        model: 'AI_INTERVIEW_DEEP_MODEL_NAME'
      }
    ),
    screenshotModel: withEndpointEnv(
      { ...defaultConfig.screenshotModel, ...stored.screenshotModel },
      {
        baseURL: 'AI_INTERVIEW_SCREENSHOT_MODEL_BASE_URL',
        apiKey: 'AI_INTERVIEW_SCREENSHOT_MODEL_API_KEY',
        model: 'AI_INTERVIEW_SCREENSHOT_MODEL_NAME'
      }
    ),
    knowledgeBase: {
      ...defaultConfig.knowledgeBase,
      ...stored.knowledgeBase,
      enabled: stored.knowledgeBase?.enabled ?? defaultConfig.knowledgeBase.enabled,
      dirPath: stored.knowledgeBase?.dirPath ?? defaultConfig.knowledgeBase.dirPath,
      topK: stored.knowledgeBase?.topK ?? defaultConfig.knowledgeBase.topK,
      embedding: withEndpointEnv(
        { ...defaultConfig.knowledgeBase.embedding, ...stored.knowledgeBase?.embedding },
        {
          baseURL: 'AI_INTERVIEW_EMBEDDING_BASE_URL',
          apiKey: 'AI_INTERVIEW_EMBEDDING_API_KEY',
          model: 'AI_INTERVIEW_EMBEDDING_MODEL'
        }
      )
    },
    screenshotMode: stored.screenshotMode ?? defaultConfig.screenshotMode,
    answerLanguage: stored.answerLanguage ?? defaultConfig.answerLanguage,
    autoAnswer: stored.autoAnswer ?? defaultConfig.autoAnswer,
    screenshotHotkey: stored.screenshotHotkey || defaultConfig.screenshotHotkey,
    screenshotTripleClick: stored.screenshotTripleClick ?? defaultConfig.screenshotTripleClick
  };

  return configSchema.parse(current);
}

export function saveConfig(config: AppConfig): AppConfig {
  const parsed = configSchema.parse(normalizeConfig(config));
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2), 'utf8');
  return parsed;
}

function normalizeConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    fastModel: {
      ...config.fastModel,
      apiKey: normalizeDeepSeekKey(config.fastModel.apiKey, config.fastModel.baseURL)
    }
  };
}

function normalizeDeepSeekKey(apiKey: string, baseURL: string): string {
  const trimmed = apiKey.trim();

  if (!trimmed || trimmed.startsWith('sk-') || !baseURL.includes('api.deepseek.com')) {
    return trimmed;
  }

  return `sk-${trimmed}`;
}

function withEndpointEnv(
  endpoint: AppConfig['fastModel'],
  envNames: {
    baseURL: string;
    apiKey: string;
    model: string;
  }
): AppConfig['fastModel'] {
  return {
    ...endpoint,
    baseURL: endpoint.baseURL || envString(envNames.baseURL),
    apiKey: endpoint.apiKey || envString(envNames.apiKey),
    model: endpoint.model || envString(envNames.model)
  };
}

function envString(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function readStoredConfig(): Partial<AppConfig> {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const rawConfig = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(rawConfig) as Partial<AppConfig>;
  } catch {
    return {};
  }
}
