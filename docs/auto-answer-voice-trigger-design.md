# 自动答题 / 语音触发设计

> 最后更新：2026-06-13。

## 目标

在现有「系统音频收题 + 两段式快答/深答」流程上叠加自动触发模式：开启后，根据系统音频转写的静默间隔自动代替两次手动停止。

## 当前缺口

现有流程依赖用户手动点击或热键触发：

- `collecting` 阶段第一次停止，调用 `generateFastOnly()` 生成快答。
- `fastSubmitted` 阶段第二次停止，调用 `generateDeepFromFullQuestion()` 停止音频并生成深答。

面试官停顿时无法自动推进，长面试中需要持续手动操作。

## 锁定决策

- 新增配置 `autoAnswer: boolean`，默认 `false`。
- 不改音频采集、ASR、系统音频收题拼接逻辑。
- 静默检测只基于系统音频转写事件：每收到一条有效系统音频转写后重置定时器。
- `collecting` 阶段静默 `1600ms` 自动调用 `generateFastOnly()`。
- `fastSubmitted` 阶段静默 `3500ms` 自动调用 `generateDeepFromFullQuestion()`。
- 继续复用 `generateFastOnly` / `generateDeepFromFullQuestion` 内部重入保护，手动按钮和热键不降级。

## 非目标

- 不新增 VAD、音频能量检测或 ASR 拼接策略。
- 不改变系统音频和麦克风双流职责。
- 不新增主进程 IPC 或协议。

## 状态与配置影响

- `AppConfig` 增加 `autoAnswer`。
- `defaultConfig` 默认关闭。
- `configStore` 的 zod schema 必须包含该字段，避免 `.parse()` strip 未知字段导致配置丢失。
- 渲染层用 ref 同步配置开关，避免系统音频监听回调读取过期闭包。

## 验收标准

- 关闭自动答题时，手动两段式流程行为保持一致。
- 开启自动答题时，系统音频转写停止约 1.6 秒后自动出快答，快答后继续收题。
- 快答阶段继续收到系统音频转写会重置深答静默计时；停止约 3.5 秒后自动生成深答。
- 停止监听、清空本轮、生成深答和组件卸载时清理 timeout。
- `npx tsc -p tsconfig.node.json --noEmit`、`npx tsc -p tsconfig.json --noEmit`、`npm test` 通过。
