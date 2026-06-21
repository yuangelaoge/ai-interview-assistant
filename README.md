# AI 面试助手

一个 Windows 桌面悬浮窗 MVP，基于 Electron + React 构建，用于实时辅助技术面试回答。

应用会持续采集系统音频作为面试官问题入口，同时转写麦克风候选人回答。用户按 `CommandOrControl+Enter` 或点击主按钮时，应用会对当前累计问题同时生成 2-4 句极速快答和流式深答，然后清空问题缓冲并继续收音等待下一题。

## 功能特性

- Windows 桌面悬浮窗，支持置顶显示。
- 系统音频作为面试官问题入口，麦克风转写仅作为候选人回答显示。
- 持续收音收题：
  - `开始收题` 后持续累积当前问题。
  - 按 `CommandOrControl+Enter` 或主按钮回答当前问题，快答和深答同时启动。
  - 回答后立即清空问题缓冲，系统音频继续累积下一题。
- 快答支持两种模式：
  - 零上下文模式：不读取资料，只根据当前问题生成稳妥短答。
  - 上下文模式：读取单个 `.md`、`.txt` 或 `.pdf` 文件，最多约 10k 字符。
- 深答支持两种模式：
  - 长上下文模式：读取单个 `.md`、`.txt` 或 `.pdf` 文件，最多约 256k 字符。
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

## 部署与启动

### 1. 环境要求

- **Node.js ≥ 20**（推荐 ≥ 22，可消除部分依赖的 engine 警告）。
- **平台**：macOS 优先（系统音频采集、笔试截图、macOS 系统语音识别均依赖 macOS 能力）；Windows 可用网页/会议软件场景下的多数功能，但系统音频(audiotee)与 macOS 语音识别不适用。
- **macOS 构建工具**：`npm run dev`/`build` 会用 `swiftc` 编译随应用打包的语音识别 helper，需安装 Xcode Command Line Tools：`xcode-select --install`。

### 2. 安装依赖

```bash
npm install
```

会一并安装可选原生包：`audiotee`（系统音频）、`screenshot-desktop`（截图）、`uiohook-napi`（全局三击）、`pdf-parse`（PDF 解析）。这些在代码里是动态加载 + 优雅降级——即使某个安装失败，应用仍能启动，仅对应功能不可用。

### 3. 开发模式启动

```bash
npm run dev
```

该命令依次执行：编译 macOS 语音 helper → 编译主进程(`tsc`) → 启动 Vite(`127.0.0.1:5173`) → 启动 Electron 加载开发服务。窗口会自动弹出（置顶悬浮窗）。

### 4. macOS 权限（首次必看）

很多功能依赖系统权限，**否则会"静默失败"**（如系统音频录到一片静音）。在 **系统设置 > 隐私与安全性** 中按需授权给“**你启动应用的终端**”（开发期）或“**打包后的应用**”：

| 功能 | 需要的权限（隐私与安全性内）|
|---|---|
| 系统音频采集（面试官声音） | **屏幕与系统音频录制 → 「仅系统音频录制」**（不是最上面那个分区）|
| 笔试截图 | **屏幕录制** |
| 麦克风（候选人转写） | **麦克风** |
| macOS 系统语音识别 | 首次使用自动弹窗授权 |
| 全局三击触发（默认关闭）| **辅助功能** |

> 提示：iTerm / VSCode / Cursor 的内置终端常常不弹"系统音频录制"授权而直接录到静音。可改用 macOS 自带「终端」运行，或在上表对应分区手动加入它们。授权后需**完全退出并重启**终端/应用。

### 5. 首次配置

打开窗口右上角 ⚙️ 设置面板填写：

- **语音识别 provider**：默认 **火山流式 SAUC**（国内直连、人民币计费），填 `X-Api-Key`（或旧版 App Key + Access Key）即可。其它可选：OpenAI Whisper、OpenAI Realtime、macOS 系统语音、火山 LAS。
- **快答模型 / 深答模型**：OpenAI 兼容端点 + Key + 模型名。
- 可选：答题语言、知识库、笔试截图模型。

配置保存在本机用户数据目录，不写入仓库。也可用环境变量（见下文「环境变量」）。

### 6. 本地知识库（可选，Ollama）

知识库需要一个 **OpenAI 兼容的 embedding 服务**。本地零成本方案用 [Ollama](https://ollama.com)：

```bash
ollama pull bge-m3      # 多语言/中文强
ollama serve            # http://localhost:11434
```

设置面板「知识库」：baseURL 填 `http://localhost:11434/v1`、model 填 `bge-m3`、apiKey 留空（本地免 key）、选择放简历/资料的目录、勾选启用。

### 7. 生产构建与打包

```bash
npm run build      # 构建主进程 + 渲染进程到 dist/
npm run package    # electron-builder 生成本地应用目录（mac: dir / win: nsis）到 release/
```

打包配置已通过 `asarUnpack` 解包原生模块（audiotee / screenshot-desktop / uiohook-napi / pdf-parse）。正式分发 macOS 应用还需对应用做代码签名（内置二进制会继承父应用签名）与公证。

### 常用命令

```bash
npm run typecheck   # 主进程 + 渲染进程类型检查
npm test            # vitest 单元测试
```

### 故障排查

- **系统音频"没反应"/全静音**：未授予「仅系统音频录制」权限（见第 4 节）。
- **火山流式调用失败**：确认 endpoint 为 `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel`、resourceId 为 `volc.bigasr.sauc.duration`、并已在控制台开通服务。
- **OpenAI / Realtime 连不上**：中国大陆需代理；多数"中转"不代理 Realtime 的 WebSocket。
- **PDF 检索不到内容**：确认已安装 `pdf-parse`（`npm install`）。

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

上下文模式支持单个 `.md` / `.txt` / `.pdf` 文件；PDF 会自动提取文本，需安装 `pdf-parse`。

这样做是为了：

- 减少读取和发送给模型的无关内容。
- 避免误把整个目录、私密文件或大体积文件发送给 AI 服务商。
- 让快答和深答的延迟更可控。

推荐内容：

- 快答上下文：简历、岗位 JD、项目简介、常见问答。
- 深答上下文：项目架构、技术选型、核心模块说明、难点复盘。

## 知识库 (RAG)

知识库目录支持 `.md` / `.txt` / `.pdf` 文件。PDF 会自动提取文本，需安装 `pdf-parse`；未安装或解析失败时，该 PDF 按空文本跳过，其它资料继续正常检索。

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

- 暂不做账号体系。
- 暂不做云端同步。
- 知识库为本地内存向量检索（按目录指纹缓存），暂不接入独立向量数据库。
- ASR 效果依赖麦克风输入质量和服务商能力。
- 火山流式 ASR 仍属于实验接入，实际可用性取决于账号开通的资源和密钥类型。

## 许可证

请根据你的开源计划补充 License 文件，例如 MIT、Apache-2.0 或其他协议。
