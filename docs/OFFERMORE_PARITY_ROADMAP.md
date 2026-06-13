# 对齐「面试猫 / offermore」能力路线图

> 目标：把本项目做成尽量贴近面试猫的 AI 面试辅助软件。本文是功能差距清单 + 实施顺序，供逐次推进。
> 最后更新：2026-06-13。

## 现状（已具备）

- 系统音频（面试官）+ 麦克风（候选人）双流采集，UI 区分说话人。见 [SYSTEM_AUDIO_HANDOFF.md](./SYSTEM_AUDIO_HANDOFF.md)。
- 两段式收题：第一次停止出快答（小模型，2-4 句口语化），第二次停止出深答（流式，长上下文 / 代码库 Agent）。
- 单文件上下文（快答 10k / 深答 256k）、代码仓库只读 Agent。
- 多 ASR provider：OpenAI 兼容 Whisper、macOS 系统语音、火山 LAS、火山流式 SAUC。
- 桌面悬浮窗（置顶、无边框）、确认热键。

## 面试猫有、本项目缺（按价值排序）

| # | 能力 | 面试猫场景 | 实施状态 |
|---|---|---|---|
| 1 | **截图答题 / 笔试模式** | 客户端/笔试模式核心：截屏→视觉模型→选择/问答/算法题作答，ACM 模式输出可提交代码 | ✅ 已完成 |
| 2 | **自动答题 / 语音触发** | 检测面试官说完（静默）自动触发快答，免手动两次停止 | ✅ 已完成 |
| 3 | **多语言翻译** | 问题/答案双语，外语面试 | 🚧 进行中 |
| 4 | **深色模式** | 深色 UI 主题切换 | 待做 |
| 5 | **RAG 知识库** | 多文件/向量检索（当前仅单文件），更贴合个人背景 | 待做 |
| 6 | **窗口隐身 / 防检测** | 隐藏图标、排除截屏共享 | 待做（平台相关，风险项） |

## #1 截图答题 / 笔试模式（实施中）

设计要点：
- 主进程用 `desktopCapturer.getSources({ types:['screen'] })` 拿全屏截图（thumbnailSize 设为屏幕分辨率，限宽降 token），转 base64 PNG data URL。
- 新增 `screenshotModel`（OpenAI 兼容视觉模型，默认 gpt-4.1）、`screenshotMode: 'general' | 'acm'`、`screenshotHotkey` 配置。
- 复用 `streamChatCompletion`，messages 用 `image_url` content 数组，流式回 UI（镜像 deep-stream 事件模式）。
- 全局热键一键截屏解题；UI 新增「笔试截图」按钮 + 答案面板。
- ⚠️ configStore 用 zod `.parse()` 默认 strip 未知字段，新增配置项必须同步加进 `configSchema`。

## 工作流约定

- 写代码用 codex subagent，主 agent review（typecheck + test + 读 diff）。
- 命令加 `rtk` 前缀；npm install / 联网命令需用户本地手动执行。
