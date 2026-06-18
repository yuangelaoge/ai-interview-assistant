import fs from 'node:fs';
import path from 'node:path';
import type { DeepAgentTraceStep, DeepAnswerResult, ModelEndpointConfig } from '../../shared/types';
import { chatCompletion, streamChatCompletion } from './openAiCompatible';
import { trimContext } from '../utils/text';
import { loadDeepContext } from './shallowContext';

const IGNORE_DIRS = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.turbo',
  'coverage',
  'dist',
  'build',
  'node_modules',
  'release',
  'out'
]);

const READABLE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.mdx',
  '.css',
  '.scss',
  '.html',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.cs',
  '.cpp',
  '.c',
  '.h',
  '.sql',
  '.yaml',
  '.yml',
  '.toml'
]);

interface RankedFile {
  path: string;
  score: number;
}

interface DeepAnswerOptions {
  onDelta?: (delta: string) => void;
}

const DEEP_DIRECT_ANSWER_RULES =
  '你是实时技术面试深答助手。你的输出会被候选人直接照着说，所以必须像候选人本人正在回答面试官，使用第一人称“我”，直接回答问题本身。不要解释你在做什么，不要确认场景，不要说“我先确认一下”，不要说“通用模板/回答思路/可套用”，不要反问面试官，不要要求用户补充信息，不要暴露“模拟面试”“系统”“上下文”“代码仓库”“资料不足”等系统视角。信息不足时，也要给出保守但完整的可口述回答：用“我会更保守地说...”或“我主要从...考虑”承接，但不能变成答题建议。输出中文，结构清晰，可以分段，但每一句都应该是候选人在现场可直接说出口的内容。';

export async function generateDeepContextAnswer(
  config: ModelEndpointConfig,
  question: string,
  contextPath: string,
  options: DeepAnswerOptions = {}
): Promise<DeepAnswerResult> {
  const context = await loadDeepContext(contextPath, 256000);
  const messages = [
    {
      role: 'system' as const,
      content:
        `${DEEP_DIRECT_ANSWER_RULES} 当前可以参考用户提供的长上下文资料生成更完整的回答，包含回答主线、关键技术细节、项目案例表达和可追问延展。只使用资料中能支持的信息；资料没有覆盖的细节，用保守表述补足，不要编造具体事实。`
    },
    {
      role: 'user' as const,
      content: `面试官问题：\n${question}\n\n可参考资料：\n${context}\n\n请直接生成候选人第一人称深度回答，不要输出模板、思路说明、场景确认或让用户替换内容。`
    }
  ];
  const answer = sanitizeDeepAnswer(await streamableChatCompletion(
    config,
    messages,
    {
      temperature: 0.25,
      maxTokens: 1800
    },
    options.onDelta
  ));

  return {
    answer,
    trace: [
      {
        type: 'read',
        label: '读取长上下文',
        detail: contextPath.trim() ? '已按 256k 上限加载深答上下文资料' : '未配置深答上下文，已使用谨慎通用回答'
      },
      {
        type: 'answer',
        label: '生成深度回答',
        detail: '上下文模式已完成'
      }
    ]
  };
}

export async function generateDeepAnswer(
  config: ModelEndpointConfig,
  question: string,
  workspacePath: string,
  options: DeepAnswerOptions = {}
): Promise<DeepAnswerResult> {
  const trace: DeepAgentTraceStep[] = [];

  if (!workspacePath.trim()) {
    const answer = await fallbackAnswer(config, question, '用户尚未配置代码仓库目录。', options);
    return {
      answer,
      trace: [
        {
          type: 'answer',
          label: '跳过仓库读取',
          detail: '未配置代码仓库目录，已使用大模型基于问题直接作答。'
        }
      ]
    };
  }

  const root = path.resolve(workspacePath);
  const rootStat = await fs.promises.stat(root).catch(() => undefined);

  if (!rootStat?.isDirectory()) {
    const answer = await fallbackAnswer(config, question, '配置的代码仓库目录不存在或不是目录。', options);
    return {
      answer,
      trace: [
        {
          type: 'answer',
          label: '仓库不可用',
          detail: root
        }
      ]
    };
  }

  const readme = await loadRepositoryReadme(root);
  if (readme) {
    trace.push({
      type: 'read',
      label: '优先读取 README',
      detail: path.relative(root, readme.path)
    });

    if (isReadmeEnoughForQuestion(readme.content, question)) {
      const answer = await generateRepositoryAnswer(
        config,
        question,
        `## ${path.relative(root, readme.path)}\n${trimContext(readme.content, 32000)}`,
        'README',
        options
      );
      trace.push({
        type: 'answer',
        label: '生成深度回答',
        detail: 'README 已满足问题，未扫描代码'
      });
      return { answer, trace };
    }

    trace.push({
      type: 'search',
      label: 'README 不足',
      detail: 'README 信息较少或与问题匹配度不足，继续扫描代码'
    });
  }

  const files = await collectWorkspaceFiles(root, 700);
  trace.push({
    type: 'tree',
    label: '读取文件树',
    detail: `扫描到 ${files.length} 个可读文件`
  });

  const ranked = rankFilesByQuestion(files, question).slice(0, 8);
  trace.push({
    type: 'search',
    label: '搜索相关文件',
    detail: ranked.map((item) => path.relative(root, item.path)).join('\n') || '未命中明显相关文件'
  });

  const selected = ranked.length > 0 ? ranked : files.slice(0, 6).map((file) => ({ path: file, score: 0 }));
  const snippets = await Promise.all(
    selected.map(async (item) => {
      const content = await fs.promises.readFile(item.path, 'utf8').catch(() => '');
      trace.push({
        type: 'read',
        label: '读取代码片段',
        detail: path.relative(root, item.path)
      });

      return `## ${path.relative(root, item.path)}\n${trimContext(content, 7000)}`;
    })
  );

  const repositoryContext = trimContext(snippets.filter(Boolean).join('\n\n'), 32000);
  const answer = await generateRepositoryAnswer(config, question, repositoryContext, '代码片段', options);

  trace.push({
    type: 'answer',
    label: '生成深度回答',
    detail: '已完成'
  });

  return { answer, trace };
}

async function generateRepositoryAnswer(
  config: ModelEndpointConfig,
  question: string,
  repositoryContext: string,
  contextKind: 'README' | '代码片段',
  options: DeepAnswerOptions
): Promise<string> {
  const messages = [
    {
      role: 'system' as const,
      content:
        `${DEEP_DIRECT_ANSWER_RULES} 当前处于代码仓库模式，必须优先参考 README；只有 README 不能满足问题时才参考代码片段。你可以参考当前提供的${contextKind}生成回答，包含回答主线、技术细节、项目案例和可追问延展。只能基于上下文里能支持的信息表达具体实现；不确定时用保守措辞，不要编造未出现的事实。`
    },
    {
      role: 'user' as const,
      content: `面试官问题：\n${question}\n\n可参考${contextKind}上下文：\n${repositoryContext}\n\n请直接生成候选人第一人称深度回答，不要输出模板、思路说明、场景确认或让用户替换内容。`
    }
  ];

  return sanitizeDeepAnswer(await streamableChatCompletion(
    config,
    messages,
    {
      temperature: 0.25,
      maxTokens: 1800
    },
    options.onDelta
  ));
}

async function streamableChatCompletion(
  config: ModelEndpointConfig,
  messages: Parameters<typeof chatCompletion>[1],
  options: Parameters<typeof chatCompletion>[2],
  onDelta?: (delta: string) => void
): Promise<string> {
  if (!onDelta) {
    return chatCompletion(config, messages, options);
  }

  return streamChatCompletion(config, messages, onDelta, options);
}

async function fallbackAnswer(
  config: ModelEndpointConfig,
  question: string,
  reason: string,
  options: DeepAnswerOptions = {}
): Promise<string> {
  return streamableChatCompletion(
    config,
    [
      {
        role: 'system',
        content:
          `${DEEP_DIRECT_ANSWER_RULES} 当前没有可用代码或项目资料时，也必须直接回答面试官问题。可以给出保守的一人称回答，强调自己的判断框架、取舍和实践习惯，但不要说“没有资料”“不能编造”“下面给模板”。`
      },
      {
        role: 'user',
        content: `内部状态：${reason}\n\n面试官问题：${question}\n\n请直接生成候选人第一人称回答，不要输出模板、思路说明、场景确认或让用户替换内容。`
      }
    ],
    {
      temperature: 0.35,
      maxTokens: 1200
    },
    options.onDelta
  );
}

function sanitizeDeepAnswer(content: string): string {
  return content
    .replace(/^好的[，,。]?\s*/g, '')
    .replace(/^我先确认一下[^。！？!?]*[。！？!?]?\s*/g, '')
    .replace(/^您是在[^。！？!?]*[。！？!?]?\s*/g, '')
    .replace(/由于我这里没有[^。！？!?]*[。！？!?]?\s*/g, '')
    .replace(/我会给出一个[^。！？!?]*(模板|思路)[^。！？!?]*[。！？!?]?\s*/g, '')
    .replace(/您可以按照自己的真实情况[^。！？!?]*[。！？!?]?\s*/g, '')
    .trim();
}

async function loadRepositoryReadme(root: string): Promise<{ path: string; content: string } | undefined> {
  const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
  const readmeEntry = entries.find((entry) => entry.isFile() && /^readme(\.(md|mdx|txt))?$/i.test(entry.name));

  if (!readmeEntry) {
    return undefined;
  }

  const readmePath = path.join(root, readmeEntry.name);
  const content = await fs.promises.readFile(readmePath, 'utf8').catch(() => '');
  return content.trim() ? { path: readmePath, content } : undefined;
}

function isReadmeEnoughForQuestion(readme: string, question: string): boolean {
  const normalizedReadme = readme.trim().toLowerCase();
  if (normalizedReadme.length < 400) {
    return false;
  }

  const tokens = extractQuestionTokens(question);
  if (tokens.length === 0) {
    return true;
  }

  const hitCount = tokens.filter((token) => normalizedReadme.includes(token)).length;
  const asksProjectOverview = /(为什么|背景|介绍|项目|痛点|价值|架构|核心|流程|亮点|难点|what|why|overview|architecture|feature)/i.test(question);
  return asksProjectOverview || hitCount >= Math.min(2, tokens.length);
}


async function collectWorkspaceFiles(root: string, limit: number): Promise<string[]> {
  const output: string[] = [];
  const queue = [root];

  while (queue.length > 0 && output.length < limit) {
    const current = queue.shift()!;
    const entries = await fs.promises.readdir(current, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) {
          queue.push(absolute);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (READABLE_EXTENSIONS.has(ext)) {
        output.push(absolute);
      }

      if (output.length >= limit) {
        break;
      }
    }
  }

  return output;
}

function rankFilesByQuestion(files: string[], question: string): RankedFile[] {
  const tokens = extractQuestionTokens(question);

  return files
    .map((file) => {
      const normalized = file.toLowerCase().replace(/\\/g, '/');
      const score = tokens.reduce((sum, token) => sum + (normalized.includes(token) ? token.length : 0), 0);
      const nameBoost = /readme|package|app|main|index|router|service|controller|api|component|store/.test(normalized)
        ? 2
        : 0;

      return {
        path: file,
        score: score + nameBoost
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
}

function extractQuestionTokens(question: string): string[] {
  return Array.from(
    new Set(
      question
        .toLowerCase()
        .split(/[^a-z0-9_\u4e00-\u9fa5]+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2)
    )
  );
}
