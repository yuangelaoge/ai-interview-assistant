# AI 面试助手

一个 Windows 桌面悬浮窗 MVP，基于 Electron + React 构建，用于实时辅助技术面试回答。

应用会采集麦克风声音，转写面试官问题。用户手动点击两次停止：第一次生成 2-4 句极速快答，第二次把完整问题交给深答模型，并在界面中流式输出更完整的回答。

## 功能特性

- Windows 桌面悬浮窗，支持置顶显示。
- 只采集麦克风环境音，MVP 暂不采集系统音频。
- 手动两段式收题：
  - 第一次停止：把当前问题片段发给快答小模型。
  - 第二次停止：把完整问题发给深答大模型。
- 快答支持两种模式：
  - 零上下文模式：不读取资料，只根据当前问题生成稳妥短答。
  - 上下文模式：读取单个 `.md` 或 `.txt` 文件，最多约 10k 字符。
- 深答支持两种模式：
  - 长上下文模式：读取单个 `.md` 或 `.txt` 文件，最多约 256k 字符。
  - 代码仓库模式：只读扫描代码仓库，读取相关文件片段后生成回答。
- 快答模型、深答模型、语音识别 API 三套配置互相独立。
- 模型接口默认按 OpenAI 兼容协议设计。
- 支持 OpenAI 兼容 Whisper、OpenAI Realtime 流式转写、macOS 系统语音识别、火山引擎 LAS ASR 和实验性的火山流式 ASR。
- 深答支持流式输出，生成过程中会持续追加到界面。

## 技术栈

- Electron
- React
- TypeScript
- Vite
- OpenAI 兼容 SDK
- Volcengine ASR

## 快速开始

```bash
npm install
npm run dev
```

## 常用命令

```bash
npm run typecheck
npm test
npm run build
npm run package
```

说明：

- `npm run dev` 启动开发环境。
- `npm run build` 构建 Electron 主进程和渲染进程。
- `npm run package` 使用 electron-builder 生成本地 Windows 应用目录。

## 配置方式

应用右上角设置面板可以配置所有 API。配置会保存到 Electron 的本机用户数据目录，不会写入仓库源码。

也可以通过环境变量配置。优先级是：本机设置面板配置 > 环境变量 > 默认空配置。

建议复制 `.env.example` 为 `.env` 后再填写真实密钥。`.env` 已被 `.gitignore` 忽略。

## 环境变量

### 快答小模型

```bash
AI_INTERVIEW_FAST_MODEL_BASE_URL=https://api.deepseek.com
AI_INTERVIEW_FAST_MODEL_API_KEY=
AI_INTERVIEW_FAST_MODEL_NAME=deepseek-v4-flash
```

### 深答大模型

```bash
AI_INTERVIEW_DEEP_MODEL_BASE_URL=https://api.openai.com/v1
AI_INTERVIEW_DEEP_MODEL_API_KEY=
AI_INTERVIEW_DEEP_MODEL_NAME=gpt-4.1
```

### OpenAI 兼容语音识别

```bash
AI_INTERVIEW_ASR_OPENAI_BASE_URL=https://api.openai.com/v1
AI_INTERVIEW_ASR_OPENAI_API_KEY=
AI_INTERVIEW_ASR_OPENAI_MODEL=whisper-1
```

### OpenAI Realtime 系统音频转写

选择 `OpenAI 实时转写(gpt-4o-transcribe)` provider 时，系统音频会以 24k PCM 持续推送到 OpenAI Realtime API，由服务端 VAD 自动断句。

```bash
AI_INTERVIEW_OPENAI_REALTIME_BASE_URL=https://api.openai.com/v1
AI_INTERVIEW_OPENAI_REALTIME_API_KEY=
AI_INTERVIEW_OPENAI_REALTIME_MODEL=gpt-4o-transcribe
```

### macOS 系统语音识别

选择 `macOS 系统语音识别` provider 时无需 API Key。应用会把当前麦克风 WAV 片段交给随应用构建的 Swift helper，并通过 Apple Speech framework 识别。

```bash
AI_INTERVIEW_MACOS_SPEECH_LOCALE=zh-CN
AI_INTERVIEW_MACOS_SPEECH_ON_DEVICE=0
AI_INTERVIEW_MACOS_SPEECH_TIMEOUT=12
```

说明：

- 首次使用会触发 macOS 语音识别权限。
- `AI_INTERVIEW_MACOS_SPEECH_ON_DEVICE=1` 会要求尽量使用本机识别，但实际支持取决于 macOS 版本、语言和系统资源。
- 该 provider 仅支持 macOS；Windows 版本请继续使用 OpenAI 兼容 Whisper 或火山 ASR。

### 火山引擎 LAS ASR

```bash
AI_INTERVIEW_VOLCENGINE_LAS_ENDPOINT=https://operator.las.cn-beijing.volces.com/api/v1
AI_INTERVIEW_VOLCENGINE_LAS_API_KEY=
AI_INTERVIEW_VOLCENGINE_LAS_APP_KEY=
AI_INTERVIEW_VOLCENGINE_LAS_ACCESS_KEY=
AI_INTERVIEW_VOLCENGINE_LAS_RESOURCE_ID=las_asr
AI_INTERVIEW_VOLCENGINE_LAS_MODEL_NAME=bigmodel
```

### 火山引擎流式 ASR

```bash
AI_INTERVIEW_VOLCENGINE_SAUC_ENDPOINT=wss://openspeech.bytedance.com/api/v3/sauc/bigmodel
AI_INTERVIEW_VOLCENGINE_SAUC_API_KEY=
AI_INTERVIEW_VOLCENGINE_SAUC_APP_KEY=
AI_INTERVIEW_VOLCENGINE_SAUC_ACCESS_KEY=
AI_INTERVIEW_VOLCENGINE_SAUC_RESOURCE_ID=volc.bigasr.sauc.duration
AI_INTERVIEW_VOLCENGINE_SAUC_MODEL_NAME=bigmodel
```

## 上下文文件

上下文模式只支持单个 `.md` 或 `.txt` 文件。

这样做是为了：

- 减少读取和发送给模型的无关内容。
- 避免误把整个目录、私密文件或大体积文件发送给 AI 服务商。
- 让快答和深答的延迟更可控。

推荐内容：

- 快答上下文：简历、岗位 JD、项目简介、常见问答。
- 深答上下文：项目架构、技术选型、核心模块说明、难点复盘。

## 代码仓库模式

深答的代码仓库模式会只读扫描本地仓库：

- 读取文件树。
- 搜索相关文件。
- 读取相关代码片段。
- 调用深答模型生成结构化回答。

当前 Agent 不会执行命令、不会修改文件、不会运行测试。

## 安全说明

开源前请确认不要提交真实密钥。

本仓库已经做了这些处理：

- 默认配置里的所有 `apiKey` / `accessKey` 都是空字符串。
- `.env`、`.env.*`、`dist/`、`release/`、`node_modules/`、日志和本地配置文件都已加入 `.gitignore`。
- `.env.example` 只保留空模板。
- API 密钥可以通过本机设置面板或环境变量提供。

发布前建议再执行：

```bash
rg -n --hidden --glob '!node_modules/**' --glob '!dist/**' --glob '!release/**' "sk-|apiKey|accessKey|Bearer|token|secret|password|X-Api-Key" .
```

命中字段名是正常的；如果出现真实密钥，请先删除并轮换密钥。

## MVP 边界

- 暂不采集系统音频。
- 暂不做账号体系。
- 暂不做云端同步。
- 暂不做向量库。
- ASR 效果依赖麦克风输入质量和服务商能力。
- 火山流式 ASR 仍属于实验接入，实际可用性取决于账号开通的资源和密钥类型。

## 许可证

请根据你的开源计划补充 License 文件，例如 MIT、Apache-2.0 或其他协议。
