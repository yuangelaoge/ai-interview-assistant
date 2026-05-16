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
        '你是资深技术面试陪练助手。当前使用深答上下文模式，不读取代码仓库，只基于用户提供的长上下文资料和面试官问题生成完整回答。输出中文，结构清晰，包含回答主线、关键技术细节、项目案例表达、可追问延展。不要编造上下文里没有的具体事实；资料不足时给出保守但可口述的表达。'
    },
    {
      role: 'user' as const,
      content: `面试官问题：\n${question}\n\n深答长上下文资料（最多约 256k 字符）：\n${context}`
    }
  ];
  const answer = await streamableChatCompletion(
    config,
    messages,
    {
      temperature: 0.25,
      maxTokens: 1800
    },
    options.onDelta
  );

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
  const messages = [
    {
      role: 'system' as const,
      content:
        '你是资深技术面试陪练助手。你会基于代码仓库上下文，帮助候选人用口语化但专业的方式回答面试官问题。输出中文，结构清晰，包含回答主线、技术细节、项目案例、可追问延展。不要编造未在上下文中出现的具体事实；不确定时说明可以保守表述。'
    },
    {
      role: 'user' as const,
      content: `面试官问题：\n${question}\n\n代码仓库相关上下文：\n${repositoryContext}`
    }
  ];
  const answer = await streamableChatCompletion(
    config,
    messages,
    {
      temperature: 0.25,
      maxTokens: 1800
    },
    options.onDelta
  );

  trace.push({
    type: 'answer',
    label: '生成深度回答',
    detail: '已完成'
  });

  return { answer, trace };
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
          '你是技术面试回答助手。请在没有代码仓库上下文时，给出谨慎、通用、可口述的中文回答，并明确避免虚构具体实现。'
      },
      {
        role: 'user',
        content: `原因：${reason}\n\n面试官问题：${question}`
      }
    ],
    {
      temperature: 0.35,
      maxTokens: 1200
    },
    options.onDelta
  );
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
  const tokens = Array.from(
    new Set(
      question
        .toLowerCase()
        .split(/[^a-z0-9_\u4e00-\u9fa5]+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2)
    )
  );

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
