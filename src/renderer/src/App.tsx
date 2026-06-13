import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot,
  Braces,
  Check,
  ClipboardList,
  Code2,
  Flag,
  Mic,
  MicOff,
  PanelTopClose,
  Radio,
  Send,
  Settings,
  Sparkles
} from 'lucide-react';
import type { AnswerResult, AppConfig, RuntimeState, TranscriptSegment } from '../../shared/types';
import { defaultConfig } from '../../shared/defaultConfig';
import { SettingsPanel } from './components/SettingsPanel';
import { StatusPill } from './components/StatusPill';
import { MicrophoneRecorder } from './utils/audio';
import { isLikelyQuestion, normalizeQuestion } from './utils/question';

const initialState: RuntimeState = {
  isListening: false,
  capturePhase: 'idle',
  transcript: [],
  activeQuestion: '',
  statuses: {
    asr: 'idle',
    fastModel: 'idle',
    deepAgent: 'idle'
  }
};

export function App() {
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [state, setState] = useState<RuntimeState>(initialState);
  const [showSettings, setShowSettings] = useState(false);
  const [notice, setNotice] = useState('准备就绪。点击开始收题：系统音频作为面试官问题入口，麦克风转写候选人回答。');
  const [deepTrace, setDeepTrace] = useState<string[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const recorderRef = useRef<MicrophoneRecorder | undefined>(undefined);
  const activeQuestionRef = useRef('');
  // 系统音频会话（面试官问题入口，顺序由主进程保证）
  const captureSessionIdRef = useRef('');
  // 麦克风会话（候选人回答，仅显示，不进 activeQuestion）
  const micSessionIdRef = useRef('');
  const stateRef = useRef(initialState);
  const fastRequestRef = useRef('');
  const deepRequestRef = useRef('');

  useEffect(() => {
    window.interviewAssistant
      .getConfig()
      .then((loaded) => {
        setConfig(loaded);
        setNotice(`确认热键：${loaded.confirmHotkey}`);
      })
      .catch((error) => {
        setNotice(error instanceof Error ? error.message : '应用初始化失败。');
        setState((current) => ({
          ...current,
          statuses: {
            ...current.statuses,
            asr: 'error'
          }
        }));
      });
  }, []);

  useEffect(() => {
    activeQuestionRef.current = state.activeQuestion;
    stateRef.current = state;
  }, [state.activeQuestion]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // 麦克风（候选人）：转写后仅作为 candidate 条目显示，绝不触碰 activeQuestion / 收题状态机。
  const handleMicChunk = useCallback(async (payload: Parameters<typeof window.interviewAssistant.transcribeAudio>[0]) => {
    const sessionId = payload.captureSessionId;
    if (!sessionId || sessionId !== micSessionIdRef.current) {
      return;
    }

    try {
      const result = await window.interviewAssistant.transcribeAudio({ ...payload, speaker: 'candidate' });
      if (sessionId !== micSessionIdRef.current) {
        return;
      }

      const text = normalizeQuestion(result.text);
      if (!text) {
        return;
      }

      const segment: TranscriptSegment = {
        id: `mic-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        text,
        timestamp: result.timestamp,
        confidence: result.confidence,
        isCandidateQuestion: false,
        speaker: 'candidate'
      };

      setState((current) => ({
        ...current,
        transcript: [segment, ...current.transcript].slice(0, 14)
      }));
    } catch {
      // 麦克风转写失败静默跳过，不阻断系统音频这一问题入口。
    }
  }, []);

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  const resetQuestionCapture = useCallback(() => {
    void window.interviewAssistant.stopSystemAudio();
    activeQuestionRef.current = '';
    captureSessionIdRef.current = '';
    micSessionIdRef.current = '';
    fastRequestRef.current = '';
    deepRequestRef.current = '';
    recorderRef.current?.stop();
    recorderRef.current = undefined;
    setMicLevel(0);
    setDeepTrace([]);
    setState((current) => ({
      ...current,
      isListening: false,
      capturePhase: 'idle',
      activeQuestion: '',
      currentAnswer: undefined,
      statuses: {
        ...current.statuses,
        asr: 'idle',
        fastModel: 'idle',
        deepAgent: 'idle'
      }
    }));
  }, []);

  const startListening = useCallback(async () => {
    if (stateRef.current.isListening) {
      return;
    }

    let latestConfig = config;

    try {
      latestConfig = await window.interviewAssistant.getConfig();
      setConfig(latestConfig);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '读取配置失败。');
    }

    const asrConfigError = validateAsrConfig(latestConfig);
    if (asrConfigError) {
      setShowSettings(true);
      setState((current) => ({
        ...current,
        statuses: {
          ...current.statuses,
          asr: 'error'
        }
      }));
      setNotice(asrConfigError);
      return;
    }

    setState((current) => ({
      ...current,
      statuses: {
        ...current.statuses,
        asr: 'thinking'
      }
    }));
    setNotice('正在启动系统音频采集（面试官问题入口）...');

    const sessionId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    try {
      const result = await window.interviewAssistant.startSystemAudio(sessionId);
      if (!result.ok) {
        throw new Error(result.message ?? '系统音频采集启动失败。');
      }
    } catch (error) {
      captureSessionIdRef.current = '';
      setState((current) => ({
        ...current,
        isListening: false,
        statuses: {
          ...current.statuses,
          asr: 'error'
        }
      }));
      setNotice(`${error instanceof Error ? error.message : '系统音频采集启动失败。'} 可在上方手动输入问题后点生成。`);
      return;
    }

    captureSessionIdRef.current = sessionId;
    activeQuestionRef.current = '';
    fastRequestRef.current = '';
    deepRequestRef.current = '';
    setState((current) => ({
      ...current,
      isListening: true,
      capturePhase: 'collecting',
      activeQuestion: '',
      statuses: {
        ...current.statuses,
        asr: 'listening'
      }
    }));

    // 麦克风（候选人）：失败不阻断系统音频问题入口。
    let micOk = false;
    try {
      const flushIntervalMs = latestConfig.asr.provider === 'macos-speech' ? 3000 : 1000;
      const recorder = new MicrophoneRecorder(handleMicChunk, setNotice, undefined, setMicLevel, flushIntervalMs);
      await recorder.start();
      recorderRef.current = recorder;
      micSessionIdRef.current = recorder.sessionId;
      micOk = true;
    } catch {
      setMicLevel(0);
      micSessionIdRef.current = '';
    }

    setNotice(
      micOk
        ? '正在收题：系统音频作为面试官问题入口。第一次停止生成快答，第二次停止生成深答。'
        : '系统音频已开始收题（麦克风未启动，候选人转写不可用）。第一次停止生成快答，第二次停止生成深答。'
    );
  }, [config, handleMicChunk]);

  const stopListening = useCallback(() => {
    void window.interviewAssistant.stopSystemAudio();
    recorderRef.current?.stop();
    recorderRef.current = undefined;
    micSessionIdRef.current = '';
    captureSessionIdRef.current = '';
    setMicLevel(0);
    setState((current) => ({
      ...current,
      isListening: false,
      capturePhase: current.capturePhase === 'collecting' ? 'idle' : current.capturePhase,
      statuses: {
        ...current.statuses,
        asr: 'idle'
      }
    }));
    setNotice('已停止监听。');
  }, []);

  const runDeepAnswer = useCallback((question: string, answerId?: string) => {
    const targetAnswerId = answerId ?? `deep-${Date.now()}`;
    if (!answerId) {
      setState((current) => ({
        ...current,
        currentAnswer: {
          id: targetAnswerId,
          question,
          fastAnswer: current.currentAnswer?.fastAnswer ?? '',
          fastStatus: current.currentAnswer?.fastStatus ?? 'idle',
          deepAnswer: '',
          deepStatus: 'thinking',
          createdAt: current.currentAnswer?.createdAt ?? Date.now(),
          updatedAt: Date.now()
        }
      }));
    }

    setState((current) => ({
      ...current,
      currentAnswer:
        current.currentAnswer?.id === targetAnswerId
          ? {
              ...current.currentAnswer,
              deepAnswer: '',
              error: undefined,
              deepStatus: 'thinking',
              updatedAt: Date.now()
            }
          : current.currentAnswer,
      statuses: {
        ...current.statuses,
        deepAgent: 'thinking'
      }
    }));
    setDeepTrace([config.deepAnswerMode === 'codebase' ? '深答 Agent 已启动，正在读取代码仓库。' : '深答 Agent 已启动，正在读取长上下文。']);

    const requestId = `deep-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    deepRequestRef.current = requestId;
    void window.interviewAssistant.generateDeepAnswerStream(requestId, question).catch((error) => {
      if (deepRequestRef.current !== requestId) {
        return;
      }

      const message = error instanceof Error ? error.message : '深度回答流式启动失败。';
      deepRequestRef.current = '';
      setState((current) => ({
        ...current,
        currentAnswer:
          current.currentAnswer?.id === targetAnswerId
            ? {
                ...current.currentAnswer,
                deepStatus: 'error',
                error: message,
                updatedAt: Date.now()
              }
            : current.currentAnswer,
        statuses: {
          ...current.statuses,
          deepAgent: 'error'
        }
      }));
      setNotice(message);
    });
  }, [config.deepAnswerMode]);

  const generateFastOnly = useCallback(async () => {
    if (fastRequestRef.current || stateRef.current.statuses.fastModel === 'thinking') {
      return;
    }

    const question = activeQuestionRef.current.trim();
    if (!question) {
      setNotice('还没有收集到问题内容，可以继续听或在上方手动输入。');
      return;
    }

    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    fastRequestRef.current = requestId;
    const answerId = `answer-${Date.now()}`;
    const createdAt = Date.now();

    setState((current) => ({
      ...current,
      capturePhase: 'fastSubmitted',
      statuses: {
        ...current.statuses,
        fastModel: 'thinking',
        deepAgent: 'idle'
      },
      currentAnswer: {
        id: answerId,
        question,
        fastAnswer: '快答生成中...',
        fastStatus: 'thinking',
        deepStatus: 'idle',
        createdAt,
        updatedAt: createdAt
      }
    }));
    setDeepTrace(['第一次停止已触发，系统音频继续收完整问题后第二次停止生成深答。']);
    setNotice('第一次停止：正在生成快答，系统音频继续收完整问题。');

    try {
      const fastAnswer = await window.interviewAssistant.generateFastAnswer(question);
      if (fastRequestRef.current !== requestId) {
        return;
      }

      setState((current) => {
        if (current.currentAnswer?.id !== answerId) {
          return current;
        }

        return {
          ...current,
          currentAnswer: {
            ...current.currentAnswer,
            fastAnswer,
            fastStatus: 'ready',
            updatedAt: Date.now()
          },
          statuses: {
            ...current.statuses,
            fastModel: 'ready'
          }
        };
      });
      if (fastRequestRef.current === requestId) {
        fastRequestRef.current = '';
      }
      setNotice('快答已生成。面试官问完后再点第二次停止生成深答。');
    } catch (error) {
      if (fastRequestRef.current !== requestId) {
        return;
      }

      const message = error instanceof Error ? error.message : '快答生成失败。';
      const failedAnswer: AnswerResult = {
        id: `error-${Date.now()}`,
        question,
        fastAnswer: '',
        fastStatus: 'error',
        deepStatus: 'idle',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        error: message
      };

      setState((current) => ({
        ...current,
        currentAnswer: current.currentAnswer?.id === answerId ? failedAnswer : current.currentAnswer,
        statuses: {
          ...current.statuses,
          fastModel: 'error',
          deepAgent: 'idle'
        }
      }));
      if (fastRequestRef.current === requestId) {
        fastRequestRef.current = '';
      }
      setNotice(message);
    }
  }, []);

  const generateDeepFromFullQuestion = useCallback(async () => {
    if (stateRef.current.statuses.deepAgent === 'thinking') {
      return;
    }

    setNotice('第二次停止：正在停止系统音频并补齐最后一段...');
    setState((current) => ({
      ...current,
      isListening: false,
      statuses: {
        ...current.statuses,
        asr: 'thinking'
      }
    }));

    // 停止系统音频（主进程会 flush 最后一段并推送最后的 transcript），停止麦克风。
    await window.interviewAssistant.stopSystemAudio();
    recorderRef.current?.stop();
    recorderRef.current = undefined;
    micSessionIdRef.current = '';
    setMicLevel(0);
    // 给最后一段 transcript 事件留出处理时间（IPC 主→渲染保序）。
    await wait(80);

    const question = activeQuestionRef.current.trim();
    captureSessionIdRef.current = '';

    if (!question) {
      setState((current) => ({
        ...current,
        capturePhase: 'idle',
        statuses: {
          ...current.statuses,
          asr: 'idle',
          deepAgent: 'idle'
        }
      }));
      setNotice('还没有完整问题内容，无法生成深答。');
      return;
    }

    setState((current) => ({
      ...current,
      isListening: false,
      capturePhase: 'idle',
      currentAnswer: current.currentAnswer
        ? {
            ...current.currentAnswer,
            question,
            deepStatus: 'thinking',
            updatedAt: Date.now()
          }
        : current.currentAnswer,
      statuses: {
        ...current.statuses,
        asr: 'idle',
        deepAgent: 'thinking'
      }
    }));
    setNotice('第二次停止：完整问题已提交深答。');
    void runDeepAnswer(question, stateRef.current.currentAnswer?.id);
  }, [runDeepAnswer]);

  const handleCaptureButton = useCallback(() => {
    const latest = stateRef.current;
    if (!latest.isListening) {
      void startListening();
      return;
    }

    if (latest.capturePhase === 'collecting') {
      void generateFastOnly();
      return;
    }

    if (latest.capturePhase === 'fastSubmitted') {
      void generateDeepFromFullQuestion();
    }
  }, [generateDeepFromFullQuestion, generateFastOnly, startListening]);

  const confirmQuestion = useCallback(() => {
    if (state.capturePhase === 'fastSubmitted') {
      void generateDeepFromFullQuestion();
      return;
    }

    void generateFastOnly();
  }, [generateDeepFromFullQuestion, generateFastOnly, state.capturePhase]);

  useEffect(() => {
    return window.interviewAssistant.onConfirmHotkey(() => {
      confirmQuestion();
    });
  }, [confirmQuestion]);

  // 系统音频转写（面试官）：merge 进 activeQuestion 驱动收题状态机，并作为 interviewer 条目显示。
  useEffect(() => {
    return window.interviewAssistant.onSystemAudioTranscript((transcript) => {
      if (transcript.sessionId !== captureSessionIdRef.current) {
        return;
      }
      if (stateRef.current.capturePhase === 'idle') {
        return;
      }

      const text = normalizeQuestion(transcript.text);
      if (!text) {
        return;
      }

      const merged = mergeQuestionText(activeQuestionRef.current, text);
      activeQuestionRef.current = merged;

      const segment: TranscriptSegment = {
        id: `sys-${transcript.sessionId}-${transcript.sequence}`,
        text,
        timestamp: transcript.timestamp,
        confidence: transcript.confidence,
        isCandidateQuestion: isLikelyQuestion(text),
        sequence: transcript.sequence,
        speaker: 'interviewer'
      };

      setState((current) => {
        if (current.capturePhase === 'idle') {
          return current;
        }

        return {
          ...current,
          activeQuestion: merged,
          transcript: [segment, ...current.transcript].slice(0, 14),
          statuses: {
            ...current.statuses,
            asr: current.isListening ? 'listening' : current.statuses.asr
          }
        };
      });
    });
  }, []);

  useEffect(() => {
    return window.interviewAssistant.onSystemAudioStatus((status) => {
      if (status.sessionId !== captureSessionIdRef.current) {
        return;
      }
      if (status.message) {
        setNotice(status.message);
      }
    });
  }, []);

  useEffect(() => {
    return window.interviewAssistant.onDeepAnswerStream((chunk) => {
      if (chunk.requestId !== deepRequestRef.current) {
        return;
      }

      if (chunk.delta) {
        setState((current) => {
          if (!current.currentAnswer) {
            return current;
          }

          return {
            ...current,
            currentAnswer: {
              ...current.currentAnswer,
              deepAnswer: `${current.currentAnswer.deepAnswer ?? ''}${chunk.delta}`,
              deepStatus: 'thinking',
              updatedAt: Date.now()
            }
          };
        });
      }

      if (!chunk.done) {
        return;
      }

      deepRequestRef.current = '';

      if (chunk.error) {
        setState((current) => ({
          ...current,
          currentAnswer: current.currentAnswer
            ? {
                ...current.currentAnswer,
                deepStatus: 'error',
                error: chunk.error,
                updatedAt: Date.now()
              }
            : current.currentAnswer,
          statuses: {
            ...current.statuses,
            deepAgent: 'error'
          }
        }));
        setNotice(chunk.error);
        return;
      }

      if (chunk.result) {
        setDeepTrace(chunk.result.trace.map((step) => `${step.label}: ${step.detail}`));
        setState((current) => ({
          ...current,
          currentAnswer: current.currentAnswer
            ? {
                ...current.currentAnswer,
                deepAnswer: chunk.result?.answer || current.currentAnswer.deepAnswer,
                deepStatus: 'ready',
                updatedAt: Date.now()
              }
            : current.currentAnswer,
          statuses: {
            ...current.statuses,
            deepAgent: 'ready'
          }
        }));
        setNotice('深度回答已完成。');
      }
    });
  }, []);

  const saveSettings = async () => {
    const currentConfig = await window.interviewAssistant.getConfig().catch(() => config);
    const mergedConfig: AppConfig = {
      ...config,
      asr: {
        ...config.asr,
        openai: {
          ...config.asr.openai,
          apiKey: config.asr.openai.apiKey || currentConfig.asr.openai.apiKey
        },
        volcengine: {
          ...config.asr.volcengine,
          apiKey: config.asr.volcengine.apiKey || currentConfig.asr.volcengine.apiKey,
          appKey: config.asr.volcengine.appKey || currentConfig.asr.volcengine.appKey,
          accessKey: config.asr.volcengine.accessKey || currentConfig.asr.volcengine.accessKey
        },
        volcengineSauc: {
          ...config.asr.volcengineSauc,
          apiKey: config.asr.volcengineSauc.apiKey || currentConfig.asr.volcengineSauc.apiKey,
          appKey: config.asr.volcengineSauc.appKey || currentConfig.asr.volcengineSauc.appKey,
          accessKey: config.asr.volcengineSauc.accessKey || currentConfig.asr.volcengineSauc.accessKey
        }
      },
      fastModel: {
        ...config.fastModel,
        apiKey: normalizeModelApiKey(
          config.fastModel.apiKey || currentConfig.fastModel.apiKey,
          config.fastModel.baseURL || currentConfig.fastModel.baseURL
        )
      },
      deepModel: {
        ...config.deepModel,
        apiKey: config.deepModel.apiKey || currentConfig.deepModel.apiKey
      }
    };
    const saved = await window.interviewAssistant.saveConfig(mergedConfig);
    setConfig(saved);
    setShowSettings(false);
    setNotice(`设置已保存，确认热键：${saved.confirmHotkey}`);
  };

  const captureButtonLabel =
    !state.isListening ? '开始收题' : state.capturePhase === 'collecting' ? '第一次停止' : '第二次停止';
  const captureButtonTitle =
    !state.isListening
      ? '启动系统音频采集并开始累积面试官问题'
      : state.capturePhase === 'collecting'
        ? '提交当前问题片段给快答，系统音频继续收完整问题'
        : '停止系统音频并提交完整问题给深答';
  const captureButtonIcon = !state.isListening ? <Mic size={16} /> : state.capturePhase === 'collecting' ? <Flag size={16} /> : <MicOff size={16} />;
  const captureButtonClass = !state.isListening ? 'primary-button' : state.capturePhase === 'collecting' ? 'primary-button' : 'danger-button';

  return (
    <main className="app-shell">
      <section className="floating-window">
        <header className="top-bar">
          <div className="brand">
            <span className="brand-mark">
              <Sparkles size={18} />
            </span>
            <div>
              <h1>AI面试助手</h1>
              <p>{notice}</p>
            </div>
          </div>

          <div className="window-actions">
            <button
              className={captureButtonClass}
              type="button"
              onClick={handleCaptureButton}
              title={captureButtonTitle}
            >
              {captureButtonIcon}
              {captureButtonLabel}
            </button>
            <button className="icon-button" type="button" onClick={() => setShowSettings(true)} aria-label="打开设置">
              <Settings size={18} />
            </button>
            <button className="icon-button muted" type="button" aria-label="悬浮窗">
              <PanelTopClose size={18} />
            </button>
          </div>
        </header>

        <div className="workspace-grid">
          <section className="panel transcript-panel">
            <header className="panel-header">
              <div>
                <h2>
                  <Radio size={17} />
                  实时转写
                </h2>
                <p>系统音频=面试官提问（问题入口），麦克风=候选人回答</p>
              </div>
              <span className="signal" title={`麦克风电平 ${Math.round(micLevel * 100)}%`}>
                {[0.18, 0.38, 0.62, 0.84].map((threshold) => (
                  <i key={threshold} className={micLevel >= threshold ? 'active' : undefined} />
                ))}
              </span>
            </header>

            <div className="manual-question">
              <textarea
                value={state.activeQuestion}
                placeholder="开始收题后会在这里累积面试官问题，也可以手动补改..."
                onChange={(event) => {
                  const value = event.target.value;
                  activeQuestionRef.current = value;
                  setState((current) => ({ ...current, activeQuestion: value }));
                }}
              />
              <button className="primary-button" type="button" onClick={confirmQuestion}>
                <Send size={16} />
                {state.capturePhase === 'fastSubmitted' ? '生成深答' : '生成快答'}
              </button>
            </div>

            <div className="candidate-box">
              <span>
                <Check size={14} />
                当前收题稿
              </span>
              <strong>{state.activeQuestion || '等待开始收题'}</strong>
            </div>

            <div className="transcript-list">
              {state.transcript.length === 0 ? (
                <div className="empty-state">
                  <ClipboardList size={28} />
                  <span>暂无转写内容</span>
                </div>
              ) : (
                state.transcript.map((item) => (
                  <article
                    key={item.id}
                    className={[
                      'transcript-item',
                      item.speaker === 'candidate' ? 'candidate' : 'interviewer',
                      item.isCandidateQuestion ? 'hot' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <div className="transcript-meta">
                      <span className="speaker-tag">{item.speaker === 'candidate' ? '候选人' : '面试官'}</span>
                      <time>{new Date(item.timestamp).toLocaleTimeString()}</time>
                    </div>
                    <p>{item.text}</p>
                    <small>置信度 {Math.round(item.confidence * 100)}%</small>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="answer-stack">
            <article className="panel fast-panel">
              <header className="panel-header">
                <div>
                  <h2>
                    <Bot size={17} />
                    极速快答
                  </h2>
                  <p>
                    小模型，2-4 句，
                    {config.fastAnswerMode === 'context' ? '10k 上下文' : '零上下文'}
                  </p>
                </div>
                <StatusPill label="快答" status={state.statuses.fastModel} />
              </header>

              <div className="answer-content quick">
                {state.currentAnswer?.fastAnswer ? (
                  <p>{state.currentAnswer.fastAnswer}</p>
                ) : (
                  <p className="placeholder">确认问题后，这里会优先出现短答案。</p>
                )}
              </div>
            </article>

            <article className="panel deep-panel">
              <header className="panel-header">
                <div>
                  <h2>
                    <Code2 size={17} />
                    深度精读
                  </h2>
                  <p>
                    {config.deepAnswerMode === 'codebase' ? '代码阅读 Agent' : '256k 上下文'}
                    ，后台补全逻辑
                  </p>
                </div>
                <StatusPill label="深答" status={state.statuses.deepAgent} />
              </header>

              <div className="agent-trace">
                <Braces size={15} />
                <span>{deepTrace[0] || '等待深答任务启动'}</span>
              </div>

              <div className="answer-content deep">
                {state.currentAnswer?.deepAnswer ? (
                  <p>{state.currentAnswer.deepAnswer}</p>
                ) : state.currentAnswer?.error ? (
                  <p className="error-text">{state.currentAnswer.error}</p>
                ) : (
                  <p className="placeholder">
                    快答返回后，深答会继续读取{config.deepAnswerMode === 'codebase' ? '仓库上下文' : '长上下文资料'}并追加完整回答。
                  </p>
                )}
              </div>
            </article>
          </section>
        </div>

        <footer className="status-rail">
          <StatusPill label="ASR" status={state.statuses.asr} />
          <StatusPill label="小模型" status={state.statuses.fastModel} />
          <StatusPill label="深答Agent" status={state.statuses.deepAgent} />
          <span className="hotkey">热键 {config.confirmHotkey}</span>
          <button className="ghost-button" type="button" onClick={resetQuestionCapture}>
            清空本轮
          </button>
        </footer>
      </section>

      {showSettings ? (
        <SettingsPanel config={config} onChange={setConfig} onSave={() => void saveSettings()} onClose={() => setShowSettings(false)} />
      ) : null}
    </main>
  );
}

function validateAsrConfig(config: AppConfig): string | undefined {
  if (config.asr.provider === 'macos-speech') {
    return undefined;
  }

  if (config.asr.provider === 'volcengine-sauc-stream') {
    const volcengineSauc = config.asr.volcengineSauc;
    if (!volcengineSauc.endpoint.trim()) {
      return '请先在设置里填写火山流式 ASR WebSocket URL。';
    }

    if (!volcengineSauc.resourceId.trim()) {
      return '请先在设置里填写火山流式 ASR Resource ID。';
    }

    if (!volcengineSauc.apiKey.trim() && !(volcengineSauc.appKey.trim() && volcengineSauc.accessKey.trim())) {
      return '请先在设置里填写火山流式 ASR 的 X-Api-Key，或旧版 App Key / Access Key。';
    }

    return undefined;
  }

  if (config.asr.provider === 'volcengine-auc-flash') {
    const volcengine = config.asr.volcengine;
    if (!volcengine.apiKey.trim()) {
      return '请先在设置里填写 LAS 控制台创建的 API Key。';
    }

    if (!volcengine.endpoint.trim()) {
      return '请先在设置里填写 LAS ASR Base URL，例如 https://operator.las.cn-beijing.volces.com/api/v1。';
    }

    if (!volcengine.resourceId.trim()) {
      return '请先在设置里填写 LAS ASR operatorId，默认是 las_asr。';
    }
    return undefined;
  }

  if (!config.asr.openai.apiKey.trim()) {
    return '请先在设置里填写 OpenAI 兼容 ASR 的 apiKey。';
  }

  return undefined;
}

function mergeQuestionText(current: string, next: string): string {
  const normalizedNext = normalizeQuestion(next);
  if (!normalizedNext) {
    return current;
  }

  const normalizedCurrent = normalizeQuestion(current);
  if (!normalizedCurrent) {
    return normalizedNext;
  }

  if (normalizedCurrent.endsWith(normalizedNext)) {
    return normalizedCurrent;
  }

  if (normalizedNext.startsWith(normalizedCurrent)) {
    return normalizedNext;
  }

  const overlap = findTextOverlap(normalizedCurrent, normalizedNext);
  if (overlap > 0) {
    return `${normalizedCurrent}${normalizedNext.slice(overlap)}`;
  }

  return `${normalizedCurrent}${needsSpaceBetween(normalizedCurrent, normalizedNext) ? ' ' : ''}${normalizedNext}`;
}

function findTextOverlap(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  for (let length = max; length >= 2; length -= 1) {
    if (left.slice(-length) === right.slice(0, length)) {
      return length;
    }
  }
  return 0;
}

function needsSpaceBetween(left: string, right: string): boolean {
  return /[a-z0-9]$/i.test(left) && /^[a-z0-9]/i.test(right);
}

function normalizeModelApiKey(apiKey: string, baseURL: string): string {
  const trimmed = apiKey.trim();

  if (!trimmed || trimmed.startsWith('sk-') || !baseURL.includes('api.deepseek.com')) {
    return trimmed;
  }

  return `sk-${trimmed}`;
}
