import { FolderOpen, KeyRound, Save, X } from 'lucide-react';
import type { AppConfig, ModelEndpointConfig } from '../../../shared/types';

interface SettingsPanelProps {
  config: AppConfig;
  onChange: (config: AppConfig) => void;
  onSave: () => void;
  onClose: () => void;
}

export function SettingsPanel({ config, onChange, onSave, onClose }: SettingsPanelProps) {
  const updateEndpoint = (key: 'asr' | 'fastModel' | 'deepModel' | 'screenshotModel', patch: Partial<ModelEndpointConfig>) => {
    if (key === 'asr') {
      onChange({
        ...config,
        asr: {
          ...config.asr,
          openai: {
            ...config.asr.openai,
            ...patch
          }
        }
      });
      return;
    }

    onChange({
      ...config,
      [key]: {
        ...config[key],
        ...patch
      }
    });
  };

  const choosePath = async (field: 'shallowDocsPath' | 'deepContextPath' | 'codeWorkspacePath') => {
    const selectedPath =
      field === 'shallowDocsPath' || field === 'deepContextPath'
        ? await window.interviewAssistant.selectFiles()
        : await window.interviewAssistant.selectDirectory();

    if (selectedPath) {
      onChange({
        ...config,
        [field]: selectedPath
      });
    }
  };

  return (
    <aside className="settings-panel" aria-label="设置">
      <header className="settings-header">
        <div>
          <h2>设置</h2>
          <p>ASR、快答小模型、深答大模型独立配置</p>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="关闭设置">
          <X size={18} />
        </button>
      </header>

      <div className="settings-body">
        <section className="endpoint-section">
          <h3>
            <KeyRound size={15} />
            语音识别 API
          </h3>
          <label className="field">
            <span>provider</span>
            <select
              value={config.asr.provider}
              onChange={(event) =>
                onChange({
                  ...config,
                  asr: {
                    ...config.asr,
                    provider: event.target.value as AppConfig['asr']['provider']
                  }
                })
              }
            >
              <option value="volcengine-sauc-stream">火山流式语音识别</option>
              <option value="volcengine-auc-flash">LAS 豆包语音 ASR</option>
              <option value="macos-speech">macOS 系统语音识别</option>
              <option value="openai-compatible">OpenAI 兼容 Whisper</option>
            </select>
          </label>

          {config.asr.provider === 'volcengine-sauc-stream' ? (
            <VolcengineSaucFields
              config={config}
              onChange={(patch) =>
                onChange({
                  ...config,
                  asr: {
                    ...config.asr,
                    volcengineSauc: {
                      ...config.asr.volcengineSauc,
                      ...patch
                    }
                  }
                })
              }
            />
          ) : config.asr.provider === 'volcengine-auc-flash' ? (
            <VolcengineFields
              config={config}
              onChange={(patch) =>
                onChange({
                  ...config,
                  asr: {
                    ...config.asr,
                    volcengine: {
                      ...config.asr.volcengine,
                      ...patch
                    }
                  }
                })
              }
            />
          ) : config.asr.provider === 'macos-speech' ? (
            <MacosSpeechFields />
          ) : (
            <EndpointFields
              title="OpenAI 兼容 ASR"
              endpoint={config.asr.openai}
              onChange={(patch) => updateEndpoint('asr', patch)}
              embedded
            />
          )}
        </section>

        <EndpointFields
          title="快答小模型 API（默认 DeepSeek Flash）"
          endpoint={config.fastModel}
          onChange={(patch) => updateEndpoint('fastModel', patch)}
          preset={{
            label: 'DeepSeek Flash',
            value: {
              baseURL: 'https://api.deepseek.com',
              model: 'deepseek-v4-flash'
            }
          }}
        />

        <section className="endpoint-section">
          <h3>
            <KeyRound size={15} />
            答题语言
          </h3>
          <label className="field">
            <span>语言</span>
            <select
              value={config.answerLanguage}
              onChange={(event) =>
                onChange({
                  ...config,
                  answerLanguage: event.target.value as AppConfig['answerLanguage']
                })
              }
            >
              <option value="auto">跟随问题</option>
              <option value="zh">中文</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
            </select>
          </label>
        </section>

        <section className="endpoint-section">
          <h3>
            <KeyRound size={15} />
            快答模式
          </h3>
          <label className="field">
            <span>模式</span>
            <select
              value={config.fastAnswerMode}
              onChange={(event) =>
                onChange({
                  ...config,
                  fastAnswerMode: event.target.value as AppConfig['fastAnswerMode']
                })
              }
            >
              <option value="zero-context">零上下文模式</option>
              <option value="context">上下文模式（10k）</option>
            </select>
          </label>

          {config.fastAnswerMode === 'context' ? (
            <label className="field">
              <span>快答上下文文件（md/txt）</span>
              <div className="input-with-action">
                <input
                  value={config.shallowDocsPath}
                  onChange={(event) => onChange({ ...config, shallowDocsPath: event.target.value })}
                />
                <button type="button" className="icon-button" onClick={() => choosePath('shallowDocsPath')} aria-label="选择快答上下文文件">
                  <FolderOpen size={16} />
                </button>
              </div>
            </label>
          ) : (
            <p className="field-help">零上下文模式不会读取资料，快答只基于当前问题生成稳妥短话术。</p>
          )}
        </section>

        <EndpointFields
          title="深答大模型 API"
          endpoint={config.deepModel}
          onChange={(patch) => updateEndpoint('deepModel', patch)}
        />

        <section className="endpoint-section">
          <h3>
            <KeyRound size={15} />
            深答模式
          </h3>
          <label className="field">
            <span>模式</span>
            <select
              value={config.deepAnswerMode}
              onChange={(event) =>
                onChange({
                  ...config,
                  deepAnswerMode: event.target.value as AppConfig['deepAnswerMode']
                })
              }
            >
              <option value="context">上下文模式（256k）</option>
              <option value="codebase">代码仓库模式</option>
            </select>
          </label>

          {config.deepAnswerMode === 'context' ? (
            <label className="field">
              <span>深答长上下文文件（md/txt）</span>
              <div className="input-with-action">
                <input
                  value={config.deepContextPath}
                  onChange={(event) => onChange({ ...config, deepContextPath: event.target.value })}
                />
                <button type="button" className="icon-button" onClick={() => choosePath('deepContextPath')} aria-label="选择深答长上下文文件">
                  <FolderOpen size={16} />
                </button>
              </div>
            </label>
          ) : (
            <label className="field">
              <span>代码仓库</span>
              <div className="input-with-action">
                <input
                  value={config.codeWorkspacePath}
                  onChange={(event) => onChange({ ...config, codeWorkspacePath: event.target.value })}
                />
                <button type="button" className="icon-button" onClick={() => choosePath('codeWorkspacePath')} aria-label="选择代码仓库">
                  <FolderOpen size={16} />
                </button>
              </div>
            </label>
          )}
        </section>

        <EndpointFields
          title="笔试截图 / 视觉模型"
          endpoint={config.screenshotModel}
          onChange={(patch) => updateEndpoint('screenshotModel', patch)}
        />

        <section className="endpoint-section">
          <h3>
            <KeyRound size={15} />
            笔试截图模式
          </h3>
          <label className="field">
            <span>模式</span>
            <select
              value={config.screenshotMode}
              onChange={(event) =>
                onChange({
                  ...config,
                  screenshotMode: event.target.value as AppConfig['screenshotMode']
                })
              }
            >
              <option value="general">通用解题</option>
              <option value="acm">ACM 算法</option>
            </select>
          </label>

          <label className="field">
            <span>笔试截图热键</span>
            <input value={config.screenshotHotkey} onChange={(event) => onChange({ ...config, screenshotHotkey: event.target.value })} />
          </label>
        </section>

        <label className="field">
          <span>确认热键</span>
          <input value={config.confirmHotkey} onChange={(event) => onChange({ ...config, confirmHotkey: event.target.value })} />
        </label>

        <label className="field checkbox-field">
          <span>自动答题（语音触发）</span>
          <input
            checked={config.autoAnswer}
            type="checkbox"
            onChange={(event) => onChange({ ...config, autoAnswer: event.target.checked })}
          />
        </label>
        <p className="field-help">开启后，面试官停顿约 1.6 秒自动出快答，约 3.5 秒自动出深答。</p>
      </div>

      <footer className="settings-footer">
        <button className="primary-button" type="button" onClick={onSave}>
          <Save size={16} />
          保存
        </button>
      </footer>
    </aside>
  );
}

function MacosSpeechFields() {
  return (
    <p className="field-help">
      使用 macOS Speech framework 调用系统语音识别，不需要 API Key。首次使用会触发系统语音识别权限；可通过
      AI_INTERVIEW_MACOS_SPEECH_LOCALE 和 AI_INTERVIEW_MACOS_SPEECH_ON_DEVICE 调整语言和本机识别偏好。
    </p>
  );
}

function VolcengineSaucFields({
  config,
  onChange
}: {
  config: AppConfig;
  onChange: (patch: Partial<AppConfig['asr']['volcengineSauc']>) => void;
}) {
  return (
    <>
      <p className="field-help">
        使用火山“大模型流式语音识别”WebSocket API。新版控制台填 X-Api-Key；Resource ID 按开通资源选择。
      </p>
      <label className="field">
        <span>WebSocket URL</span>
        <input value={config.asr.volcengineSauc.endpoint} onChange={(event) => onChange({ endpoint: event.target.value })} />
      </label>
      <label className="field">
        <span>X-Api-Key</span>
        <input
          value={config.asr.volcengineSauc.apiKey}
          type="password"
          onChange={(event) => onChange({ apiKey: event.target.value })}
        />
      </label>
      <label className="field">
        <span>Resource ID</span>
        <input
          value={config.asr.volcengineSauc.resourceId}
          onChange={(event) => onChange({ resourceId: event.target.value })}
        />
      </label>
      <label className="field">
        <span>modelName</span>
        <input value={config.asr.volcengineSauc.modelName} onChange={(event) => onChange({ modelName: event.target.value })} />
      </label>
      <label className="field checkbox-field">
        <span>非流式出字</span>
        <input
          checked={config.asr.volcengineSauc.enableNonstream}
          type="checkbox"
          onChange={(event) => onChange({ enableNonstream: event.target.checked })}
        />
      </label>
      <details className="advanced-settings">
        <summary>旧版控制台 App Key / Access Key</summary>
        <label className="field">
          <span>App Key</span>
          <input value={config.asr.volcengineSauc.appKey} onChange={(event) => onChange({ appKey: event.target.value })} />
        </label>
        <label className="field">
          <span>Access Key</span>
          <input
            value={config.asr.volcengineSauc.accessKey}
            type="password"
            onChange={(event) => onChange({ accessKey: event.target.value })}
          />
        </label>
      </details>
    </>
  );
}

function VolcengineFields({
  config,
  onChange
}: {
  config: AppConfig;
  onChange: (patch: Partial<AppConfig['asr']['volcengine']>) => void;
}) {
  return (
    <>
      <p className="field-help">
        使用 LAS 控制台创建的 API Key。麦克风录音会先临时上传到 LAS File API，再提交 ASR 任务并轮询结果。
      </p>
      <label className="field">
        <span>Base URL</span>
        <input value={config.asr.volcengine.endpoint} onChange={(event) => onChange({ endpoint: event.target.value })} />
      </label>
      <label className="field">
        <span>LAS API Key</span>
        <input
          value={config.asr.volcengine.apiKey}
          type="password"
          onChange={(event) => onChange({ apiKey: event.target.value })}
        />
      </label>
      <label className="field">
        <span>region</span>
        <input value={config.asr.volcengine.region || ''} onChange={(event) => onChange({ region: event.target.value })} />
      </label>
      <label className="field">
        <span>operatorId</span>
        <input
          value={config.asr.volcengine.resourceId}
          onChange={(event) => onChange({ resourceId: event.target.value })}
        />
      </label>
      <label className="field">
        <span>operatorVersion</span>
        <input
          value={config.asr.volcengine.operatorVersion || ''}
          onChange={(event) => onChange({ operatorVersion: event.target.value })}
        />
      </label>
      <label className="field">
        <span>modelName</span>
        <input value={config.asr.volcengine.modelName} onChange={(event) => onChange({ modelName: event.target.value })} />
      </label>
    </>
  );
}

function EndpointFields({
  title,
  endpoint,
  onChange,
  embedded = false,
  preset
}: {
  title: string;
  endpoint: ModelEndpointConfig;
  onChange: (patch: Partial<ModelEndpointConfig>) => void;
  embedded?: boolean;
  preset?: {
    label: string;
    value: Pick<ModelEndpointConfig, 'baseURL' | 'model'>;
  };
}) {
  return (
    <section className={embedded ? 'endpoint-section embedded' : 'endpoint-section'}>
      {!embedded ? (
        <h3>
          <KeyRound size={15} />
          {title}
          {preset ? (
            <button className="preset-button" type="button" onClick={() => onChange(preset.value)}>
              {preset.label}
            </button>
          ) : null}
        </h3>
      ) : null}
      <label className="field">
        <span>baseURL</span>
        <input value={endpoint.baseURL} onChange={(event) => onChange({ baseURL: event.target.value })} />
      </label>
      <label className="field">
        <span>apiKey</span>
        <input
          value={endpoint.apiKey}
          type="password"
          onChange={(event) => onChange({ apiKey: event.target.value })}
        />
      </label>
      <label className="field">
        <span>model</span>
        <input value={endpoint.model} onChange={(event) => onChange({ model: event.target.value })} />
      </label>
    </section>
  );
}
