import path from 'node:path';
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, session, shell } from 'electron';
import type { AppConfig } from '../shared/types';
import { getConfig, saveConfig } from './services/configStore';
import {
  confirmQuestion,
  generateDeepAnswerForQuestion,
  generateFastAnswer,
  translateText,
  transcribeAudio
} from './services/answerService';
import { generateScreenshotAnswer } from './services/screenshotAnswer';
import { startTripleClickTrigger, type GlobalTriggerHandle } from './services/globalTrigger';
import { startSystemAudioCapture, stopSystemAudioCapture } from './services/systemAudioCapture';

let mainWindow: BrowserWindow | undefined;
let currentHotkey = '';
let currentScreenshotHotkey = '';
let tripleClickHandle: GlobalTriggerHandle | undefined;

app.setName('ai-interview-assistant');

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 720,
    minHeight: 520,
    title: 'AI面试助手',
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    backgroundColor: '#101720',
    show: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
}

function registerIpc(): void {
  ipcMain.handle('config:get', () => getConfig());

  ipcMain.handle('config:save', (_event, config: AppConfig) => {
    const saved = saveConfig(config);
    registerConfirmHotkey(saved.confirmHotkey);
    registerScreenshotHotkey(saved.screenshotHotkey);
    applyTripleClickTrigger(saved.screenshotTripleClick);
    return saved;
  });

  ipcMain.handle('audio:transcribe', (_event, payload) => transcribeAudio(payload));
  ipcMain.handle('answer:fast', (_event, question: string) => generateFastAnswer(question));
  ipcMain.handle('answer:translate', (_event, text: string) => translateText(text));
  ipcMain.handle('answer:deep', (_event, question: string) => generateDeepAnswerForQuestion(question));
  ipcMain.handle('answer:deep-stream', async (event, requestId: string, question: string) => {
    try {
      const result = await generateDeepAnswerForQuestion(question, {
        onDelta: (delta) => {
          event.sender.send('answer:deep-stream-chunk', {
            requestId,
            delta
          });
        }
      });

      event.sender.send('answer:deep-stream-chunk', {
        requestId,
        result,
        done: true
      });
    } catch (error) {
      event.sender.send('answer:deep-stream-chunk', {
        requestId,
        error: error instanceof Error ? error.message : '深度回答生成失败。',
        done: true
      });
    }
  });
  ipcMain.handle('answer:confirm-question', (_event, question: string) => confirmQuestion(question));

  ipcMain.handle('screenshot:answer-stream', async (event, requestId: string) => {
    try {
      await generateScreenshotAnswer({
        onDelta: (delta) => {
          event.sender.send('screenshot:answer-chunk', {
            requestId,
            delta
          });
        }
      });

      event.sender.send('screenshot:answer-chunk', {
        requestId,
        done: true
      });
    } catch (error) {
      event.sender.send('screenshot:answer-chunk', {
        requestId,
        error: error instanceof Error ? error.message : '截图答题生成失败。',
        done: true
      });
    }
  });

  ipcMain.handle('system-audio:start', async (event, sessionId: string) => {
    try {
      await startSystemAudioCapture(sessionId, {
        onTranscript: (transcript) => event.sender.send('system-audio:transcript', transcript),
        onStatus: (status) => event.sender.send('system-audio:status', status)
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '系统音频采集启动失败。'
      };
    }
  });

  ipcMain.handle('system-audio:stop', () => stopSystemAudioCapture());

  ipcMain.handle('dialog:select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择目录',
      properties: ['openDirectory']
    });

    return result.canceled ? undefined : result.filePaths[0];
  });

  ipcMain.handle('dialog:select-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择上下文资料文件',
      properties: ['openFile'],
      filters: [
        {
          name: '上下文资料',
          extensions: ['md', 'txt']
        }
      ]
    });

    return result.canceled ? undefined : result.filePaths[0];
  });

  ipcMain.handle('hotkey:register', (_event, accelerator: string) => registerConfirmHotkey(accelerator));
}

function registerConfirmHotkey(accelerator: string): boolean {
  if (currentHotkey) {
    globalShortcut.unregister(currentHotkey);
    currentHotkey = '';
  }

  if (!accelerator.trim()) {
    return false;
  }

  const ok = globalShortcut.register(accelerator, () => {
    mainWindow?.webContents.send('hotkey:confirm-question');
  });

  if (ok) {
    currentHotkey = accelerator;
  }

  return ok;
}

function registerScreenshotHotkey(accelerator: string): boolean {
  if (currentScreenshotHotkey) {
    globalShortcut.unregister(currentScreenshotHotkey);
    currentScreenshotHotkey = '';
  }

  if (!accelerator.trim()) {
    return false;
  }

  const ok = globalShortcut.register(accelerator, () => {
    mainWindow?.webContents.send('screenshot:hotkey');
  });

  if (ok) {
    currentScreenshotHotkey = accelerator;
  }

  return ok;
}

function applyTripleClickTrigger(enabled: boolean): void {
  tripleClickHandle?.stop();
  tripleClickHandle = undefined;

  if (enabled) {
    tripleClickHandle = startTripleClickTrigger(() => {
      mainWindow?.webContents.send('screenshot:hotkey');
    });
  }
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(['media', 'microphone'].includes(String(permission)));
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return ['media', 'microphone'].includes(String(permission));
  });

  registerIpc();
  createWindow();
  const config = getConfig();
  registerConfirmHotkey(config.confirmHotkey);
  registerScreenshotHotkey(config.screenshotHotkey);
  applyTripleClickTrigger(config.screenshotTripleClick);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  tripleClickHandle?.stop();
  globalShortcut.unregisterAll();
  void stopSystemAudioCapture();
});
