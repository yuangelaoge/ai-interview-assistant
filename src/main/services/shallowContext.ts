import fs from 'node:fs';
import path from 'node:path';
import { trimContext } from '../utils/text';

const CONTEXT_EXTENSIONS = new Set(['.md', '.txt']);

export async function loadShallowContext(targetPath: string, maxChars = 10000): Promise<string> {
  return loadDocumentContext({
    targetPath,
    maxChars,
    emptyMessage: '用户尚未配置浅层资料。回答时请基于问题本身给出通用但谨慎的面试话术。',
    missingMessage: '浅层资料路径不存在。回答时请基于问题本身给出通用但谨慎的面试话术。',
    directoryMessage: '浅层资料只支持单个 md 或 txt 文件，不支持文件夹。请在设置里选择一个整理好的上下文文件。',
    unsupportedMessage: '浅层资料只支持 md 或 txt 文件。请在设置里选择一个 .md 或 .txt 文件。',
    unreadableMessage: '未读取到可用浅层文本资料。'
  });
}

export async function loadDeepContext(targetPath: string, maxChars = 256000): Promise<string> {
  return loadDocumentContext({
    targetPath,
    maxChars,
    emptyMessage: '用户尚未配置深答上下文资料。请基于问题本身谨慎作答，不要编造具体项目事实。',
    missingMessage: '深答上下文资料路径不存在。请基于问题本身谨慎作答，不要编造具体项目事实。',
    directoryMessage: '深答上下文只支持单个 md 或 txt 文件，不支持文件夹。请在设置里选择一个整理好的长上下文文件。',
    unsupportedMessage: '深答上下文只支持 md 或 txt 文件。请在设置里选择一个 .md 或 .txt 文件。',
    unreadableMessage: '未读取到可用深答上下文资料。'
  });
}

async function loadDocumentContext({
  targetPath,
  maxChars,
  emptyMessage,
  missingMessage,
  directoryMessage,
  unsupportedMessage,
  unreadableMessage
}: {
  targetPath: string;
  maxChars: number;
  emptyMessage: string;
  missingMessage: string;
  directoryMessage: string;
  unsupportedMessage: string;
  unreadableMessage: string;
}): Promise<string> {
  if (!targetPath.trim()) {
    return emptyMessage;
  }

  const stat = await fs.promises.stat(targetPath).catch(() => undefined);

  if (!stat) {
    return missingMessage;
  }

  if (stat.isDirectory()) {
    return directoryMessage;
  }

  const ext = path.extname(targetPath).toLowerCase();
  if (!CONTEXT_EXTENSIONS.has(ext)) {
    return unsupportedMessage;
  }

  const content = await fs.promises.readFile(targetPath, 'utf8').catch(() => '');
  return trimContext(content ? `# ${path.basename(targetPath)}\n${content}` : unreadableMessage, maxChars);
}
