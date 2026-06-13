# 续作交接：macOS 系统音频采集（面试官声音作问题入口）

> 最后更新：2026-06-13。下次直接从「下一步要做什么」开始。

## 一句话现状

系统音频采集**已实现完成**（主进程 audiotee 服务 + 渲染层双流状态机 + 样式）。`npm run typecheck` / `npm test` 全过，主进程编译产物已确认 audiotee 未被降级成 `require`。**剩端到端真机验证（Task C 验证项）+ 打包（Task D）。**

## 背景与最终架构（已定，别再改）

需求：模仿「面试猫」，把**系统音频（面试官扬声器声音）作为问题入口**，**麦克风作为候选人声音**，双路同时转写，UI 区分说话人（interviewer / candidate）。平台 macOS 优先。

**关键踩坑结论**：
- 原计划的 Electron `getDisplayMedia` + `audio:'loopback'`（Chromium 路线）**在 macOS 26 Tahoe 上是坏的**（Apple 改了 Core Audio Taps 权限模型，Chromium 未适配，拿到 track 但全静音）。**这条路废弃。**
- 改用 **macOS 原生 Core Audio Taps**，通过 npm 包 **`audiotee`**（已装，`^0.0.7`，<600KB 预编译 Swift 二进制，spawn 输出 PCM）。
- **已在本机用 `node scripts/test-audiotee.mjs` 验证成功**：能拿到非静音系统音频 PCM。

**最终架构（与最初计划的差异：系统音频从渲染层移到主进程）**：

| 音频路 | 采集位置 | 技术 | 用途 |
|---|---|---|---|
| 系统音频（interviewer） | **主进程** spawn audiotee | Core Audio Taps，16k PCM | 问题入口，驱动现有收题状态机 |
| 麦克风（candidate） | 渲染层 getUserMedia | 现有 `MicrophoneRecorder` | 仅显示，标 candidate，不进 activeQuestion |

设计原则：**问题入口只来自系统音频**。系统音频独占现有收题状态机（activeQuestion 拼接 / 两段式停止 / 快答深答）。麦克风只转写显示，**绝不触碰** sequence 重组逻辑。

## audiotee 关键事实（集成必读）

- 包是 **ESM-only**（用 `import.meta.url`）。主进程是 **CommonJS**（`tsconfig.node.json` 里 `module: CommonJS`）。
- **不能 `import { AudioTee } from 'audiotee'`** —— tsc 会编成 `require('audiotee')`，运行时炸 `ERR_REQUIRE_ESM`。
- **必须用动态 import 且防止 tsc 降级**：用 `const { AudioTee } = await (Function('return import("audiotee")')())` 这种 indirection，绕过 tsc 把 `import()` 转成 `require`。（或给该文件单独配 module 解析，但 Function-eval indirection 最省事。）
- API（来自 `node_modules/audiotee/dist/index.d.ts`）：
  ```ts
  new AudioTee({ sampleRate?: number; chunkDurationMs?: number; mute?: boolean;
                 includeProcesses?: number[]; excludeProcesses?: number[]; binaryPath?: string })
  .on('data', (chunk: { data: Buffer }) => {})  // sampleRate 指定后为 16-bit int PCM mono
  .on('start'|'stop'|'error'|'log', ...)
  start(): Promise<void>;  stop(): Promise<void>;  isActive(): boolean;
  ```
- `binaryPath` 选项：**打包时必须用**，因为打包后 node_modules 路径变。参考现有 `macosSpeechAsr.ts` 的 `resolveHelperPath()` 多候选路径模式。
- 用 `sampleRate: 16000` —— 正好对齐现有 16k WAV 管线。

## 已完成的改动

1. **`src/shared/types.ts`**（✅ 已改）
   - 加 `export type Speaker = 'interviewer' | 'candidate'`
   - `AudioChunkPayload` 加 `speaker?: Speaker`
   - `TranscriptSegment` 加 `speaker?: Speaker`
   - 新增 `SystemAudioTranscript` / `SystemAudioStatus` 接口
   - `IpcChannels` 加 `startSystemAudio` / `stopSystemAudio` / `onSystemAudioTranscript` / `onSystemAudioStatus`

2. **`scripts/test-audiotee.mjs`**（✅ 临时验证脚本，验证已通过，可保留或删）

3. **`package.json`**（✅ 已装 `audiotee ^0.0.7`）

4. **阶段一 Chromium loopback 临时代码（✅ 已移除）**：main.ts 和 App.tsx 里所有 `// 临时：阶段一` 标记代码已删除。

5. **Task A 主进程服务（✅ 已做）**：
   - 新建 `src/main/utils/wav.ts`：`pcm16ToWav` / `isLikelySilentPcm16` / `bufferToArrayBuffer`。
   - 新建 `src/main/services/systemAudioCapture.ts`：动态 import audiotee（Function-eval indirection 绕过 tsc 降级，已验证编译产物无 `require("audiotee")`），1s flush，按 sequence 顺序 emit transcript，静音段跳过。
   - `src/main/main.ts`：加 `system-audio:start` / `system-audio:stop` IPC，will-quit 清理。
   - `src/main/preload.ts`：暴露 4 个新 API。

6. **Task B 渲染层双流（✅ 已做）**：`src/renderer/src/App.tsx` 重写——系统音频经 `onSystemAudioTranscript` 驱动 activeQuestion（标 interviewer），麦克风 `handleMicChunk` 仅显示 candidate；移除渲染层 mic 顺序重组逻辑；两段式停止改为 `stopSystemAudio()`。`main.tsx` / `App.test.tsx` mock 已补 4 个新方法。

7. **Task C 样式（✅ 已做）**：`styles.css` 加 `.transcript-item.interviewer` / `.candidate` / `.speaker-tag` 配色。

## 下一步要做什么

### ⚠️ Task C 端到端真机验证（未做，需 macOS + 真实音频）
`npm run dev`，用 openai-compatible ASR：系统放面试官提问音频 → activeQuestion 累积（面试官条目，蓝）；对麦克风说话 → 候选人条目出现（绿）且不进 activeQuestion；第一次停止出快答、第二次停止出深答。注意首次跑会弹 macOS 录屏/音频采集授权。

### Task A 实现细节存档（已完成，供回溯）
`src/main/services/systemAudioCapture.ts`：
- 用动态 import 加载 audiotee（见上面 ESM/CJS 坑）。
- `startSystemAudioCapture(sessionId, { onTranscript, onStatus })`：
  - `new AudioTee({ sampleRate: 16000, chunkDurationMs: 200 })`，`start()`。
  - `on('data')`：把 PCM Buffer 累积，攒够约 1 秒（参考现有 mic flush 1000ms 节奏）就：用现有 WAV 编码逻辑把 16-bit PCM 包成 WAV（注意：现有 `audio.ts` 的 `encodeWav` 在渲染层；主进程可复用 `macosSpeechAsr.ts` 的 WAV 处理思路，或抽一个共享 WAV 编码到 `src/main/utils/`）。
  - 调现有 `transcribeAudio({ mimeType:'audio/wav', data, sequence, captureSessionId: sessionId, speaker:'interviewer' })`（`answerService.ts` 已有，无状态可复用）。
  - 转写出文本 → `onTranscript({ sessionId, sequence, text, timestamp, confidence })`。
  - sequence 自增，保证顺序（参考 App.tsx 现有 sequence 重组）。
- `stopSystemAudioCapture()`：`audiotee.stop()` + 清理。
- ⚠️ provider 并发注意：`volcengine-sauc-stream`(WS) 和 `macos-speech` 双路并发可能争用，先用 openai-compatible 验证，其他 provider 后测。

`src/main/main.ts`：
- 移除阶段一临时代码（appendSwitch + setDisplayMediaRequestHandler）。
- 加 IPC：`ipcMain.handle('system-audio:start', ...)` / `('system-audio:stop', ...)`，把 onTranscript/onStatus 通过 `event.sender.send('system-audio:transcript'|'status', ...)` 推给渲染层（参考现有 `answer:deep-stream-chunk` 的事件推送模式）。

`src/main/preload.ts`：
- 暴露 `startSystemAudio` / `stopSystemAudio` / `onSystemAudioTranscript` / `onSystemAudioStatus`（参考现有 `onDeepAnswerStream` 的 on/removeListener 模式）。

### Task B：App.tsx 双流状态机（未做）
- 移除阶段一临时代码（喇叭按钮、testSystemAudio、systemAudioLevel、第二条 signal）。
- **系统音频不再走渲染层采集**，改为：`startListening` 时调 `window.interviewAssistant.startSystemAudio(sessionId)`，并 `onSystemAudioTranscript` 监听文本 → 喂现有收题状态机（activeQuestion 拼接、标 interviewer）。
- 麦克风：保留 `MicrophoneRecorder`，但 `handleMicChunk` 转写后只 push transcript（标 candidate），**不调** `markSequenceComplete`/`flushOrderedTranscript`，不动 activeQuestion。
- ref 隔离：`captureSessionIdRef`/`pendingTranscriptionsRef` 按 system/mic 分开（系统音频的顺序现在在主进程管，渲染层主要管 mic + 显示）。
- 两段式停止（`generateFastOnly`/`generateDeepFromFullQuestion`）：第二次停止时 `stopSystemAudio()` + stop mic recorder。
- 降级：系统音频起不来要明确报错 + 手动输入兜底；mic 失败不阻断系统音频。

### Task C：样式 + 验证（未做）
- `src/renderer/src/styles.css`：`.transcript-item.interviewer` / `.transcript-item.candidate` 两套配色。
- `npm run typecheck` 通过；`npm test`（含 App.test.tsx，可能要更新）通过。
- 端到端：系统放面试官提问音频 → activeQuestion 累积该文本；对麦克风说话 → candidate 条目出现且不进 activeQuestion；两段式停止出快答/深答。

### Task D：打包（后续，非必须）
- electron-builder 把 audiotee 的 `bin/audiotee` 二进制 unpack 出 asar（`asarUnpack`），用 `binaryPath` 指向解包后路径。
- Info.plist / entitlements：`NSAudioCaptureUsageDescription`、`NSMicrophoneUsageDescription`、hardened runtime audio-input entitlement。

## 工作流约定（来自全局 CLAUDE.md）
- **编写代码开 subagent 用 codex，主 agent review。**
- 命令加 `rtk` 前缀（如 `rtk npm run typecheck`）。
- **npm install / 联网命令在本环境被沙箱拦截，需用户本地手动执行。**

## 关键文件索引
- 现有 ASR 入口（复用）：`src/main/services/answerService.ts` → `transcribeAudio()`
- 现有 spawn 二进制先例：`src/main/services/macosSpeechAsr.ts`（execFile + resolveHelperPath 多候选路径）
- 现有 WAV 编码：`src/renderer/src/utils/audio.ts` → `encodeWav()`（在渲染层，主进程要复用需抽取）
- 现有收题状态机：`src/renderer/src/App.tsx`（handleAudioChunk / markSequenceComplete / flushOrderedTranscript / 两段式停止）
- 现有事件推送模式：`src/main/main.ts` 的 `answer:deep-stream` + preload `onDeepAnswerStream`
- audiotee 类型：`node_modules/audiotee/dist/index.d.ts`
- 完整计划：`/Users/town/.claude/plans/recursive-hopping-liskov.md`
