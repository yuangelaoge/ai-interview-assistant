import type { AppConfig } from './types';

export const defaultConfig: AppConfig = {
  asr: {
    provider: 'volcengine-sauc-stream',
    language: 'zh',
    openai: {
      baseURL: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'whisper-1'
    },
    openaiRealtime: {
      baseURL: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-transcribe'
    },
    volcengine: {
      endpoint: 'https://operator.las.cn-beijing.volces.com/api/v1',
      apiKey: '',
      appKey: '',
      accessKey: '',
      resourceId: 'las_asr',
      modelName: 'bigmodel',
      operatorVersion: 'v2',
      region: 'cn-beijing'
    },
    volcengineSauc: {
      endpoint: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel',
      apiKey: '',
      appKey: '',
      accessKey: '',
      resourceId: 'volc.bigasr.sauc.duration',
      modelName: 'bigmodel',
      enableNonstream: true
    }
  },
  fastModel: {
    baseURL: 'https://api.deepseek.com',
    apiKey: '',
    model: 'deepseek-v4-flash'
  },
  deepModel: {
    baseURL: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4.1'
  },
  screenshotModel: {
    baseURL: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4.1'
  },
  knowledgeBase: {
    enabled: false,
    dirPath: '',
    embedding: {
      baseURL: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'text-embedding-3-small'
    },
    topK: 6
  },
  fastAnswerMode: 'context',
  deepAnswerMode: 'codebase',
  screenshotMode: 'general',
  answerLanguage: 'auto',
  shallowDocsPath: '',
  deepContextPath: '',
  codeWorkspacePath: '',
  confirmHotkey: 'CommandOrControl+Enter',
  autoAnswer: false,
  screenshotHotkey: 'CommandOrControl+Shift+S',
  screenshotTripleClick: false
};
