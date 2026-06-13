export type ServiceStatus = 'idle' | 'listening' | 'thinking' | 'ready' | 'error';
export type CapturePhase = 'idle' | 'collecting' | 'fastSubmitted';
export type FastAnswerMode = 'zero-context' | 'context';
export type DeepAnswerMode = 'context' | 'codebase';

export interface ModelEndpointConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

export type AsrProvider = 'openai-compatible' | 'volcengine-auc-flash' | 'volcengine-sauc-stream' | 'macos-speech';

export interface VolcengineAsrConfig {
  endpoint: string;
  apiKey: string;
  appKey: string;
  accessKey: string;
  resourceId: string;
  modelName: string;
  operatorVersion?: string;
  region?: string;
}

export interface VolcengineSaucConfig {
  endpoint: string;
  apiKey: string;
  appKey: string;
  accessKey: string;
  resourceId: string;
  modelName: string;
  enableNonstream: boolean;
}

export interface AsrConfig {
  provider: AsrProvider;
  openai: ModelEndpointConfig;
  volcengine: VolcengineAsrConfig;
  volcengineSauc: VolcengineSaucConfig;
}

export interface AppConfig {
  asr: AsrConfig;
  fastModel: ModelEndpointConfig;
  deepModel: ModelEndpointConfig;
  fastAnswerMode: FastAnswerMode;
  deepAnswerMode: DeepAnswerMode;
  shallowDocsPath: string;
  deepContextPath: string;
  codeWorkspacePath: string;
  confirmHotkey: string;
}

export interface TranscriptSegment {
  id: string;
  text: string;
  timestamp: number;
  confidence: number;
  isCandidateQuestion: boolean;
  sequence?: number;
}

export interface AsrResult {
  text: string;
  timestamp: number;
  confidence: number;
}

export interface AnswerResult {
  id: string;
  question: string;
  fastAnswer: string;
  deepAnswer?: string;
  fastStatus: ServiceStatus;
  deepStatus: ServiceStatus;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface RuntimeState {
  isListening: boolean;
  capturePhase: CapturePhase;
  transcript: TranscriptSegment[];
  activeQuestion: string;
  currentAnswer?: AnswerResult;
  statuses: {
    asr: ServiceStatus;
    fastModel: ServiceStatus;
    deepAgent: ServiceStatus;
  };
}

export interface AudioChunkPayload {
  mimeType: string;
  data: ArrayBuffer;
  sequence?: number;
  captureSessionId?: string;
}

export interface DeepAgentTraceStep {
  type: 'tree' | 'search' | 'read' | 'answer';
  label: string;
  detail: string;
}

export interface DeepAnswerResult {
  answer: string;
  trace: DeepAgentTraceStep[];
}

export interface DeepAnswerStreamChunk {
  requestId: string;
  delta?: string;
  result?: DeepAnswerResult;
  error?: string;
  done?: boolean;
}

export interface IpcChannels {
  getConfig: () => Promise<AppConfig>;
  saveConfig: (config: AppConfig) => Promise<AppConfig>;
  transcribeAudio: (payload: AudioChunkPayload) => Promise<AsrResult>;
  confirmQuestion: (question: string) => Promise<AnswerResult>;
  generateFastAnswer: (question: string) => Promise<string>;
  generateDeepAnswer: (question: string) => Promise<DeepAnswerResult>;
  generateDeepAnswerStream: (requestId: string, question: string) => Promise<void>;
  onDeepAnswerStream: (callback: (chunk: DeepAnswerStreamChunk) => void) => () => void;
  selectDirectory: () => Promise<string | undefined>;
  selectFiles: () => Promise<string | undefined>;
  registerHotkey: (accelerator: string) => Promise<boolean>;
  onConfirmHotkey: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    interviewAssistant: IpcChannels;
  }
}
