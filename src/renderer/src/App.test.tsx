import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './App';
import { defaultConfig } from '../../shared/defaultConfig';
import type { SystemAudioTranscript } from '../../shared/types';

let systemAudioTranscriptHandler: ((transcript: SystemAudioTranscript) => void) | undefined;
const testConfig = {
  ...defaultConfig,
  asr: {
    ...defaultConfig.asr,
    provider: 'macos-speech' as const
  }
};

beforeEach(() => {
  systemAudioTranscriptHandler = undefined;
  window.interviewAssistant = {
    getConfig: vi.fn().mockResolvedValue(testConfig),
    saveConfig: vi.fn().mockResolvedValue(testConfig),
    transcribeAudio: vi.fn(),
    confirmQuestion: vi.fn(),
    generateFastAnswer: vi.fn().mockResolvedValue('这是快答。'),
    translateQuestion: vi.fn().mockResolvedValue(''),
    generateDeepAnswer: vi.fn(),
    generateDeepAnswerStream: vi.fn().mockResolvedValue(undefined),
    onDeepAnswerStream: vi.fn(() => () => undefined),
    captureAndAnswerScreenshot: vi.fn().mockResolvedValue(undefined),
    onScreenshotAnswerStream: vi.fn(() => () => undefined),
    onScreenshotHotkey: vi.fn(() => () => undefined),
    startSystemAudio: vi.fn().mockResolvedValue({ ok: true }),
    stopSystemAudio: vi.fn().mockResolvedValue(undefined),
    onSystemAudioTranscript: vi.fn((callback) => {
      systemAudioTranscriptHandler = callback;
      return () => undefined;
    }),
    onSystemAudioStatus: vi.fn(() => () => undefined),
    selectDirectory: vi.fn(),
    selectFiles: vi.fn(),
    registerHotkey: vi.fn(),
    onConfirmHotkey: vi.fn(() => () => undefined)
  };
});

it('renders the floating assistant workspace', async () => {
  render(<App />);

  expect(await screen.findByText('AI面试助手')).toBeInTheDocument();
  expect(screen.getByText('实时转写')).toBeInTheDocument();
  expect(screen.getByText('极速快答')).toBeInTheDocument();
  expect(screen.getByText('深度精读')).toBeInTheDocument();
});

it('answers the current collected question without stopping audio capture', async () => {
  render(<App />);

  fireEvent.click(await screen.findByRole('button', { name: /开始收题/ }));

  await waitFor(() => expect(window.interviewAssistant.startSystemAudio).toHaveBeenCalledTimes(1));
  const sessionId = vi.mocked(window.interviewAssistant.startSystemAudio).mock.calls[0]?.[0] ?? '';

  act(() => {
    systemAudioTranscriptHandler?.({
      sessionId,
      sequence: 1,
      text: '请介绍 React Hooks',
      timestamp: Date.now(),
      confidence: 0.92
    });
  });

  await waitFor(() => expect(screen.getByDisplayValue('请介绍 React Hooks')).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: /回答当前问题/ }));

  await waitFor(() => {
    expect(window.interviewAssistant.generateFastAnswer).toHaveBeenCalledWith('请介绍 React Hooks');
    expect(window.interviewAssistant.generateDeepAnswerStream).toHaveBeenCalledWith(expect.any(String), '请介绍 React Hooks');
  });

  expect(window.interviewAssistant.stopSystemAudio).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByText('等待开始收题')).toBeInTheDocument());
});
