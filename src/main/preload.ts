import { contextBridge, ipcRenderer } from 'electron';
import type { AppConfig, AudioChunkPayload, DeepAnswerStreamChunk } from '../shared/types';

contextBridge.exposeInMainWorld('interviewAssistant', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config: AppConfig) => ipcRenderer.invoke('config:save', config),
  transcribeAudio: (payload: AudioChunkPayload) => ipcRenderer.invoke('audio:transcribe', payload),
  confirmQuestion: (question: string) => ipcRenderer.invoke('answer:confirm-question', question),
  generateFastAnswer: (question: string) => ipcRenderer.invoke('answer:fast', question),
  generateDeepAnswer: (question: string) => ipcRenderer.invoke('answer:deep', question),
  generateDeepAnswerStream: (requestId: string, question: string) => ipcRenderer.invoke('answer:deep-stream', requestId, question),
  onDeepAnswerStream: (callback: (chunk: DeepAnswerStreamChunk) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, chunk: DeepAnswerStreamChunk) => callback(chunk);
    ipcRenderer.on('answer:deep-stream-chunk', listener);
    return () => ipcRenderer.removeListener('answer:deep-stream-chunk', listener);
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
