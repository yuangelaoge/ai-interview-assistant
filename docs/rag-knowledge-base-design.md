# RAG 知识库设计

> 任务状态：已完成。关联路线图：`docs/OFFERMORE_PARITY_ROADMAP.md`。

## 目标

- 在现有单文件上下文之外，新增默认关闭的目录级 RAG 知识库。
- 读取目录下 `.md` / `.txt` 文件，分块后用 OpenAI 兼容 embeddings 向量化。
- 面试官问题触发快答或深答时，在内存中按余弦相似度检索 top-K 片段，并拼接到现有上下文前面。

## 当前缺口

- 快答和深答上下文模式只支持单个文件，资料多时需要手动合并。
- 单文件上下文会整体注入，无法按问题动态筛选更相关的片段。
- 面试猫类产品有「定制知识库」能力，本项目还没有多文件向量检索层。

## 锁定决策

- 新增配置 `knowledgeBase`，默认 `enabled: false`。
- RAG 是附加层，不替代单文件上下文和代码仓库模式。
- 关闭知识库时，快答和深答行为必须与当前逻辑一致。
- 所有知识库失败场景都降级为空片段，不阻断快答、深答主流程。
- 不引入新 npm 依赖；复用现有 `openai` SDK 调 embeddings，Node `fs` 读目录，项目内实现余弦相似度。
- `knowledgeBase` 必须进入 `AppConfig`、`defaultConfig`、`configSchema` 和 `getConfig()` 合并逻辑，避免 zod strip 未声明字段。

## 非目标

- 不新增持久化向量库或数据库。
- 不改变音频、ASR、截图、自动答题、翻译逻辑。
- 不上传非 `.md` / `.txt` 文件。
- 不做 UI 外的文件管理、删除或编辑能力。

## 状态与配置影响

- `KnowledgeBaseConfig` 包含 `enabled`、`dirPath`、`embedding`、`topK`。
- embedding endpoint 支持环境变量兜底：
  - `AI_INTERVIEW_EMBEDDING_BASE_URL`
  - `AI_INTERVIEW_EMBEDDING_API_KEY`
  - `AI_INTERVIEW_EMBEDDING_MODEL`
- 主进程维护按目录路径缓存的内存索引，并用文件路径、大小、mtime 指纹判断是否需要重建。
- 设置面板新增「知识库 (RAG)」配置区，包含开关、目录、embedding endpoint 和 top-K。

## 验收标准

- `knowledgeBase` 已进入配置 schema，保存后不会丢失。
- `knowledgeBase.enabled=false` 时快答、深答输出 prompt 上下文与改动前一致。
- 目录不存在、无可用文件、缺少 embedding key、embedding 报错时，主流程继续生成答案。
- 开启知识库且配置有效时，快答和深答会在现有上下文前拼接「知识库检索片段」。
- `npx tsc -p tsconfig.node.json --noEmit`、`npx tsc -p tsconfig.json --noEmit`、`npm test` 通过。
