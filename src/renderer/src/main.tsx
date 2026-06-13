import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

if (!window.interviewAssistant) {
  window.interviewAssistant = {
    getConfig: async () => {
      throw new Error('未连接 Electron 主进程。请使用 npm run dev 打开的桌面窗口，不要直接使用浏览器页面。');
    },
    saveConfig: async () => {
      throw new Error('未连接 Electron 主进程。');
    },
    transcribeAudio: async () => {
      throw new Error('未连接 Electron 主进程，无法调用真实 ASR。');
    },
    confirmQuestion: async () => {
      throw new Error('未连接 Electron 主进程，无法生成回答。');
    },
    generateFastAnswer: async () => {
      throw new Error('未连接 Electron 主进程，无法生成快答。');
    },
    translateQuestion: async () => {
      throw new Error('未连接 Electron 主进程，无法翻译问题。');
    },
    generateDeepAnswer: async () => {
      throw new Error('未连接 Electron 主进程，无法生成深答。');
    },
    generateDeepAnswerStream: async () => {
      throw new Error('未连接 Electron 主进程，无法生成流式深答。');
    },
    onDeepAnswerStream: () => () => undefined,
    captureAndAnswerScreenshot: async () => {
      throw new Error('未连接 Electron 主进程，无法截图答题。');
    },
    onScreenshotAnswerStream: () => () => undefined,
    onScreenshotHotkey: () => () => undefined,
    startSystemAudio: async () => {
      throw new Error('未连接 Electron 主进程，无法采集系统音频。');
    },
    stopSystemAudio: async () => undefined,
    onSystemAudioTranscript: () => () => undefined,
    onSystemAudioStatus: () => () => undefined,
    selectDirectory: async () => undefined,
    selectFiles: async () => undefined,
    registerHotkey: async () => false,
    onConfirmHotkey: () => () => undefined
  };
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
