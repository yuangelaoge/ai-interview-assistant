# 笔试截图答题设计

## Goal

新增笔试截图能力：用户点击按钮或按全局热键后，主进程截取当前主显示器画面，发送给 OpenAI 兼容视觉模型，并把解题答案流式推送到渲染层展示。

本次扩展把截图采集优先切到 `screenshot-desktop`，并增加基于 `uiohook-napi` 的全局鼠标三击触发入口；两个原生包都必须通过动态加载优雅降级，避免未安装时影响 typecheck、test 或应用启动。

## Current Gap

应用已有快答、深答和深答流式输出能力，但输入都来自语音转写或手动题目文本。在线笔试、网页选择题、算法题等场景缺少直接对屏幕题目截图作答的入口。

## Locked Decisions

- 截图采集放在 Electron 主进程，优先动态加载 `screenshot-desktop` 截取 PNG；失败或未安装时回退原有 `desktopCapturer` 和 `screen` 逻辑。
- 视觉模型调用复用 `streamChatCompletion`，使用 OpenAI 多模态 message content。
- 流式事件遵循现有深答模式：IPC handler 启动任务，主进程通过 chunk 事件持续发送 `delta`，最终发送 `done` 或 `error`。
- 配置新增独立的 `screenshotModel`、`screenshotMode`、`screenshotHotkey`、`screenshotTripleClick`，不复用快答或深答模型。
- 支持两种模式：`general` 用于通用截图解题，`acm` 用于算法竞赛题并输出可提交代码。
- `uiohook-napi` 只通过 `eval('require')` 间接加载；未安装或缺少系统权限时记录警告并禁用全局三击，不影响其他入口。
- 三击检测窗口为 600ms，触发后清空计数并复用既有 `screenshot:hotkey` 事件。

## Non-goals

- 不改动音频采集、ASR、收题状态机、快答或深答逻辑。
- 不做截图区域选择，当前版本只截取主显示器。
- 不增加 OCR 本地预处理，直接把截图交给视觉模型。
- 不持久保存截图文件。

## State and Config Changes

- `AppConfig` 新增截图模型、模式和热键字段。
- `configStore` 的 zod schema 必须声明新增字段，避免保存配置时被 strip。
- 渲染层新增截图答案、状态、错误和 requestId 去重状态。
- `AppConfig`、默认配置、schema、保存合并逻辑新增 `screenshotTripleClick: boolean`，默认开启。

## API and Page Impact

- preload 暴露 `captureAndAnswerScreenshot`、`onScreenshotAnswerStream`、`onScreenshotHotkey`。
- 主进程新增 `screenshot:answer-stream` IPC handler、`screenshot:answer-chunk` 事件和 `screenshot:hotkey` 事件。
- 设置面板新增「笔试截图 / 视觉模型」配置区。
- 设置面板在「笔试截图」配置区新增全局三击触发复选框。
- 主界面窗口操作区新增「笔试截图」按钮，深答面板下方新增截图答案面板。

## Acceptance Criteria

- `npx tsc -p tsconfig.node.json --noEmit` 通过。
- `npx tsc -p tsconfig.json --noEmit` 通过。
- `src/renderer/src/App.test.tsx` 不因 preload mock 缺失而失败。
- 配置 schema、默认配置、共享类型和 `getConfig()` 合并逻辑都包含新增字段。
- 生成截图答案过程中重复请求按 requestId 和服务端生成中状态避免串流。
- 未安装 `screenshot-desktop` 时截图回退 `desktopCapturer` 仍可用。
- 未安装 `uiohook-napi` 或 macOS 未授予辅助功能权限时应用正常启动，三击入口静默禁用。
- 代码中不对 `screenshot-desktop` 或 `uiohook-napi` 使用静态 import。
