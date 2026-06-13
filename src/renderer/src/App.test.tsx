import { render, screen } from '@testing-library/react';
import { App } from './App';
import { defaultConfig } from '../../shared/defaultConfig';

beforeEach(() => {
  window.interviewAssistant = {
    getConfig: vi.fn().mockResolvedValue(defaultConfig),
    saveConfig: vi.fn().mockResolvedValue(defaultConfig),
    transcribeAudio: vi.fn(),
    confirmQuestion: vi.fn(),
    generateFastAnswer: vi.fn(),
    generateDeepAnswer: vi.fn(),
    generateDeepAnswerStream: vi.fn(),
    onDeepAnswerStream: vi.fn(() => () => undefined),
    startSystemAudio: vi.fn().mockResolvedValue({ ok: true }),
    stopSystemAudio: vi.fn().mockResolvedValue(undefined),
    onSystemAudioTranscript: vi.fn(() => () => undefined),
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
