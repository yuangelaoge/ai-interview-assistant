import path from 'node:path';
import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, session, shell } from 'electron';
import type { AppConfig } from '../shared/types';
import { getConfig, saveConfig } from './services/configStore';
import {
  confirmQuestion,
  generateDeepAnswerForQuestion,
  generateFastAnswer,
  transcribeAudio
} from './services/answerService';

let mainWindow: BrowserWindow | undefined;
let currentHotkey = '';

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
    return saved;
  });

  ipcMain.handle('audio:transcribe', (_event, payload) => transcribeAudio(payload));
  ipcMain.handle('answer:fast', (_event, question: string) => generateFastAnswer(question));
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

function registerMediaHandlers(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(['media', 'microphone', 'display-capture'].includes(String(permission)));
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return ['media', 'microphone', 'display-capture'].includes(String(permission));
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: 1,
        height: 1
      }
    });
    const screen = sources[0];

    if (!screen) {
      callback({});
      return;
    }

    callback({
      video: {
        id: screen.id,
        name: screen.name
      },
      audio: 'loopback'
    });
  });
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

app.whenReady().then(() => {
  registerMediaHandlers();
  registerIpc();
  createWindow();
  registerConfirmHotkey(getConfig().confirmHotkey);

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
  globalShortcut.unregisterAll();
});
