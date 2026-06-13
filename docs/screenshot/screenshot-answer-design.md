# 笔试截图答题设计

## Goal

新增笔试截图能力：用户点击按钮或按全局热键后，主进程截取当前主显示器画面，发送给 OpenAI 兼容视觉模型，并把解题答案流式推送到渲染层展示。

## Current Gap

应用已有快答、深答和深答流式输出能力，但输入都来自语音转写或手动题目文本。在线笔试、网页选择题、算法题等场景缺少直接对屏幕题目截图作答的入口。

## Locked Decisions

- 截图采集放在 Electron 主进程，使用 `desktopCapturer` 和 `screen`。
- 视觉模型调用复用 `streamChatCompletion`，使用 OpenAI 多模态 message content。
- 流式事件遵循现有深答模式：IPC handler 启动任务，主进程通过 chunk 事件持续发送 `delta`，最终发送 `done` 或 `error`。
- 配置新增独立的 `screenshotModel`、`screenshotMode`、`screenshotHotkey`，不复用快答或深答模型。
- 支持两种模式：`general` 用于通用截图解题，`acm` 用于算法竞赛题并输出可提交代码。

## Non-goals

- 不改动音频采集、ASR、收题状态机、快答或深答逻辑。
- 不做截图区域选择，当前版本只截取主显示器。
- 不增加 OCR 本地预处理，直接把截图交给视觉模型。
- 不持久保存截图文件。

## State and Config Changes

- `AppConfig` 新增截图模型、模式和热键字段。
- `configStore` 的 zod schema 必须声明新增字段，避免保存配置时被 strip。
- 渲染层新增截图答案、状态、错误和 requestId 去重状态。

## API and Page Impact

- preload 暴露 `captureAndAnswerScreenshot`、`onScreenshotAnswerStream`、`onScreenshotHotkey`。
- 主进程新增 `screenshot:answer-stream` IPC handler、`screenshot:answer-chunk` 事件和 `screenshot:hotkey` 事件。
- 设置面板新增「笔试截图 / 视觉模型」配置区。
- 主界面窗口操作区新增「笔试截图」按钮，深答面板下方新增截图答案面板。

## Acceptance Criteria

- `npx tsc -p tsconfig.node.json --noEmit` 通过。
- `npx tsc -p tsconfig.json --noEmit` 通过。
- `src/renderer/src/App.test.tsx` 不因 preload mock 缺失而失败。
- 配置 schema、默认配置、共享类型和 `getConfig()` 合并逻辑都包含新增字段。
- 生成截图答案过程中重复请求按 requestId 和服务端生成中状态避免串流。
