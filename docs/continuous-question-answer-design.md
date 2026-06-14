# 持续收音 / 当前问题回答设计

> 最后更新：2026-06-14。

## 目标

把收题流程从「两段式停止」改成面试中更自然的持续监听模型：开始收题后系统音频和麦克风保持运行，用户按主按钮或 `CommandOrControl+Enter` 时，对当前累计到的问题立即生成快答和深答，然后清空问题缓冲并继续收下一题。

## 当前缺口

旧流程把收题拆成两个阶段：

- 前一阶段只生成快答。
- 后一阶段才停止系统音频并生成深答。

这会迫使用户在每题上做两次操作，且后一阶段会结束本轮收音，不符合真实面试中连续问答的使用方式。

## 锁定决策

- `capturePhase` 只保留空闲和收集中两种状态。
- `startListening()` 进入 `collecting` 后持续收音，直到用户执行「清空本轮」。
- 主按钮、转写面板按钮和全局确认热键统一调用 `answerCurrentQuestion()`。
- `answerCurrentQuestion()` 读取 `activeQuestionRef.current.trim()` 作为快照；为空只提示继续听。
- 回答前立即清空 `activeQuestionRef.current` 和界面上的 `activeQuestion`，后续转写自然进入下一题缓冲。
- 快答和深答使用同一个 `currentAnswer.id`，快答非流式更新，深答沿用现有流式写入。
- 不修改音频采集服务、ASR provider、知识库检索或深答 agent 逻辑。

## 非目标

- 不新增音频能量 VAD 或新的 ASR 拼接策略。
- 不改变麦克风和系统音频的采集职责。
- 不新增回答队列；当前界面仍只展示正在生成的 `currentAnswer` 卡片。

## 状态与配置影响

- 默认确认热键改为 `CommandOrControl+Enter`。
- 自动答题改为单阶段静默触发：`collecting` 且当前问题非空时，静默阈值到达后调用 `answerCurrentQuestion()`。
- 手动「清空本轮」继续走 `resetQuestionCapture()`，负责停止系统音频、停止麦克风并回到 `idle`。

## 页面影响

- 主按钮监听中显示「回答当前问题 (⌘⏎)」。
- 转写面板的手动回答按钮显示「回答此问题」。
- 删除界面中依赖旧二阶段的分支文案和行为。

## 验收标准

- 开始收题后系统音频持续累积到 `activeQuestion`。
- 按主按钮或 `CommandOrControl+Enter` 会对当前问题同时启动快答和深答，并立即清空问题缓冲继续收音。
- 当前问题为空时只提示「还没收到面试官问题，继续听…」，不创建回答卡片。
- 自动答题开启时，静默阈值到达后执行同一套快答加深答逻辑。
- 「清空本轮」仍停止系统音频和麦克风并回到 `idle`。
- `npx tsc -p tsconfig.node.json --noEmit`、`npx tsc -p tsconfig.json --noEmit`、`npm test` 通过。
