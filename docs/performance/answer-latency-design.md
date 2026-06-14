# 快答流式化与截图降采样首字延迟优化

> 最后更新：2026-06-14。

## 目标

降低两条高频答题路径的首字延迟：让救场快答像深答一样边生成边展示；让截图答题发送给视觉模型前先降采样并转成 JPEG，减少上传体积。

## 当前缺口

- 快答调用 `generateFastAnswer` 后一次性返回，界面必须等完整文本生成完才显示，实际体验可能晚于深答流式输出。
- 截图答题把全分辨率 PNG data URL 直接发给视觉模型，图片体积偏大，视觉模型 TTFT 容易被上传时间拖慢。

## 锁定决策

- 保留 `generateFastAnswer`，供确认问题等非流式调用继续使用。
- 新增 `generateFastAnswerStream(question, onDelta)`，复用快答现有配置、上下文模式、知识库检索和 message 构造，只把模型调用切到 `streamChatCompletion`。
- 快答流式 IPC 镜像深答流式：主进程启动任务并通过 `answer:fast-stream-chunk` 推送 `delta`、`done`、`error` 和最终清洗后的 `text`。
- 渲染层用 requestId 和当前 answerId 过滤串流，只更新当前回答卡片。
- 流式增量用于尽快显示；完成时用 `sanitizeFastAnswer` 处理过的全文覆盖卡片内容。
- 截图采集先统一拿 PNG buffer，再由 `nativeImage` 降到最大宽度 1600 并以质量 72 输出 JPEG data URL。
- `nativeImage` 处理失败时回退原 PNG data URL，不因为压缩失败中断截图答题。

## 非目标

- 不改变深答、ASR、知识库检索、翻译或截图视觉模型 prompt。
- 不新增回答队列；当前界面仍只维护正在生成的当前回答。
- 不改变截图入口、全局热键或三击触发逻辑。

## 状态与 API 影响

- 共享类型新增 `FastAnswerStreamChunk`，preload API 增加 `generateFastAnswerStream` 和 `onFastAnswerStream`。
- 主进程新增 `answer:fast-stream` handler 和 `answer:fast-stream-chunk` 事件。
- 渲染层快答状态继续使用现有 `fastStatus` 和 `fastAnswer` 字段，但更新方式改为流式追加。
- `captureScreenshot()` 的返回仍是 data URL，调用方无需改动；MIME 从 PNG 变为 JPEG，宽度不超过 1600。

## 验收标准

- `npx tsc -p tsconfig.node.json --noEmit` 通过。
- `npx tsc -p tsconfig.json --noEmit` 通过。
- `npm test` 通过。
- 快答通过 `answer:fast-stream` 流式返回，UI 能边生成边显示，完成后使用清洗后的全文。
- 截图发送给视觉模型的是最大宽度 1600 的 JPEG data URL；降采样失败时仍能回退 PNG。
- 深答、ASR、知识库和翻译现有行为不受影响。
