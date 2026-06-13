# 多语言翻译设计

> 任务状态：进行中。关联路线图：`docs/OFFERMORE_PARITY_ROADMAP.md`。

## 目标

- 支持配置快答和深答的答题语言：跟随问题、简体中文、English、日本語、한국어。
- 支持把当前面试官问题一键翻译为简体中文，显示在收题稿下方，帮助外语面试时理解问题。

## 当前缺口

- 快答和深答 prompt 均默认中文，外语面试时候选人还需要手动转换答案语言。
- 当前收题稿只能显示 ASR 原文，没有轻量问题翻译入口。

## 锁定决策

- 新增配置字段 `answerLanguage`，默认 `auto`。
- 配置字段必须进入 `AppConfig`、`defaultConfig`、`configSchema` 和 `getConfig()` 合并对象，避免被 zod strip。
- 答题语言由主进程统一转成 prompt directive，快答和深答都在 system prompt 末尾追加。
- 问题翻译复用快答模型和 `chatCompletion`，只做非流式简体中文翻译。
- 渲染层通过新 IPC `answer:translate` 调用翻译，不介入音频采集、ASR、收题状态机、截图和自动答题逻辑。

## 非目标

- 不新增 ASR 源语言识别配置。
- 不翻译候选人麦克风转写。
- 不做回答内容双语对照或历史翻译缓存。
- 不改快答/深答触发条件和自动答题静默判断。

## 状态与接口变化

- `AnswerLanguage = 'auto' | 'zh' | 'en' | 'ja' | 'ko'`。
- `AppConfig.answerLanguage` 持久化。
- preload 暴露 `translateQuestion(text: string): Promise<string>`。
- renderer 新增本地 UI 状态 `questionTranslation` 和 `translating`。

## 验收标准

- `answerLanguage` 已进入 config schema，保存后不会丢失。
- `auto` 时回答语言跟随问题；中文问题仍应输出中文。
- 快答、深答上下文模式和代码仓库模式都追加语言指令。
- 当前问题为空时不发翻译请求，并给出提示。
- 翻译中按钮禁用，完成后在当前收题稿下方展示「中文翻译」。
- `npx tsc -p tsconfig.node.json --noEmit`、`npx tsc -p tsconfig.json --noEmit`、`npm test` 通过。
