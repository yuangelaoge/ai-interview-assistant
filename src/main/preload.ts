import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppConfig,
  AudioChunkPayload,
  DeepAnswerStreamChunk,
  ScreenshotAnswerStreamChunk,
  SystemAudioStatus,
  SystemAudioTranscript
} from '../shared/types';

contextBridge.exposeInMainWorld('interviewAssistant', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config: AppConfig) => ipcRenderer.invoke('config:save', config),
  transcribeAudio: (payload: AudioChunkPayload) => ipcRenderer.invoke('audio:transcribe', payload),
  confirmQuestion: (question: string) => ipcRenderer.invoke('answer:confirm-question', question),
  generateFastAnswer: (question: string) => ipcRenderer.invoke('answer:fast', question),
  translateQuestion: (text: string) => ipcRenderer.invoke('answer:translate', text),
  generateDeepAnswer: (question: string) => ipcRenderer.invoke('answer:deep', question),
  generateDeepAnswerStream: (requestId: string, question: string) => ipcRenderer.invoke('answer:deep-stream', requestId, question),
  onDeepAnswerStream: (callback: (chunk: DeepAnswerStreamChunk) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, chunk: DeepAnswerStreamChunk) => callback(chunk);
    ipcRenderer.on('answer:deep-stream-chunk', listener);
    return () => ipcRenderer.removeListener('answer:deep-stream-chunk', listener);
  },
  captureAndAnswerScreenshot: (requestId: string) => ipcRenderer.invoke('screenshot:answer-stream', requestId),
  onScreenshotAnswerStream: (callback: (chunk: ScreenshotAnswerStreamChunk) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, chunk: ScreenshotAnswerStreamChunk) => callback(chunk);
    ipcRenderer.on('screenshot:answer-chunk', listener);
    return () => ipcRenderer.removeListener('screenshot:answer-chunk', listener);
  },
  onScreenshotHotkey: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('screenshot:hotkey', listener);
    return () => ipcRenderer.removeListener('screenshot:hotkey', listener);
  },
  startSystemAudio: (sessionId: string) => ipcRenderer.invoke('system-audio:start', sessionId),
  stopSystemAudio: () => ipcRenderer.invoke('system-audio:stop'),
  onSystemAudioTranscript: (callback: (transcript: SystemAudioTranscript) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, transcript: SystemAudioTranscript) => callback(transcript);
    ipcRenderer.on('system-audio:transcript', listener);
    return () => ipcRenderer.removeListener('system-audio:transcript', listener);
  },
  onSystemAudioStatus: (callback: (status: SystemAudioStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: SystemAudioStatus) => callback(status);
    ipcRenderer.on('system-audio:status', listener);
    return () => ipcRenderer.removeListener('system-audio:status', listener);
  },
  selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),
  selectFiles: () => ipcRenderer.invoke('dialog:select-files'),
  registerHotkey: (accelerator: string) => ipcRenderer.invoke('hotkey:register', accelerator),
  onConfirmHotkey: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('hotkey:confirm-question', listener);
    return () => ipcRenderer.removeListener('hotkey:confirm-question', listener);
  }
});
