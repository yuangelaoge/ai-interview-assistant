import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { KnowledgeBaseConfig, ModelEndpointConfig } from '../../shared/types';
import { extractPdfText } from '../utils/pdf';
import { trimContext } from '../utils/text';
import { embedTexts, isLocalBaseURL } from './openAiCompatible';

const KB_EXTENSIONS = new Set(['.md', '.txt', '.pdf']);
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 120;
const MAX_FILES = 200;
const MAX_FILE_BYTES = 2_000_000;

interface KnowledgeChunk {
  text: string;
  source: string;
  vector: number[];
}

const indexCache = new Map<string, { fingerprint: string; chunks: KnowledgeChunk[] }>();

async function listKbFiles(dirPath: string): Promise<string[]> {
  const root = path.resolve(dirPath);
  const rootStat = await fs.promises.stat(root).catch(() => undefined);

  if (!rootStat?.isDirectory()) {
    return [];
  }

  const files: string[] = [];
  const queue = [root];

  while (queue.length > 0 && files.length < MAX_FILES) {
    const current = queue.shift()!;
    const entries = await fs.promises.readdir(current, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) {
          continue;
        }
        queue.push(absolute);
        continue;
      }

      if (!entry.isFile() || !KB_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }

      const stat = await fs.promises.stat(absolute).catch(() => undefined);
      if (!stat || stat.size > MAX_FILE_BYTES) {
        continue;
      }

      files.push(absolute);
      if (files.length >= MAX_FILES) {
        break;
      }
    }
  }

  return files;
}

async function computeFingerprint(files: string[], embeddingModel: string): Promise<string> {
  const hash = crypto.createHash('sha1');
  // 把 embedding 模型并入指纹：换模型后向量不兼容，需自动重建索引。
  hash.update(`model:${embeddingModel}\n`);

  for (const file of [...files].sort()) {
    const stat = await fs.promises.stat(file).catch(() => undefined);
    if (!stat) {
      continue;
    }
    hash.update(`${file}:${stat.size}:${stat.mtimeMs}\n`);
  }

  return hash.digest('hex');
}

function chunkText(text: string, source: string): Array<{ text: string; source: string }> {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const chunks: Array<{ text: string; source: string }> = [];

  if (!normalized) {
    return chunks;
  }

  const step = Math.max(1, CHUNK_SIZE - CHUNK_OVERLAP);
  for (let start = 0; start < normalized.length; start += step) {
    const chunk = normalized.slice(start, start + CHUNK_SIZE).trim();
    if (chunk) {
      chunks.push({
        text: `【来源 ${source}】\n${chunk}`,
        source
      });
    }

    if (start + CHUNK_SIZE >= normalized.length) {
      break;
    }
  }

  return chunks;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function buildIndex(dirPath: string, embedConfig: ModelEndpointConfig): Promise<KnowledgeChunk[]> {
  const root = path.resolve(dirPath);
  const files = await listKbFiles(root);
  const fingerprint = await computeFingerprint(files, embedConfig.model);
  const chunks = (
    await Promise.all(
      files.map(async (file) => {
        const ext = path.extname(file).toLowerCase();
        const content =
          ext === '.pdf'
            ? await extractPdfText(file)
            : await fs.promises.readFile(file, 'utf8').catch(() => '');
        const source = path.relative(root, file) || path.basename(file);
        return chunkText(content, source);
      })
    )
  ).flat();
  const texts = chunks.map((chunk) => chunk.text);
  const vectors = await embedTexts(embedConfig, texts);
  const indexedChunks = chunks
    .map((chunk, index) => ({
      ...chunk,
      vector: vectors[index]
    }))
    .filter((chunk): chunk is KnowledgeChunk => Array.isArray(chunk.vector));

  indexCache.set(root, {
    fingerprint,
    chunks: indexedChunks
  });

  return indexedChunks;
}

export async function retrieveKnowledge(question: string, kb: KnowledgeBaseConfig, maxChars: number): Promise<string> {
  const localEmbedding = isLocalBaseURL(kb.embedding.baseURL);
  if (!kb.enabled || !kb.dirPath.trim() || (!kb.embedding.apiKey.trim() && !localEmbedding) || !question.trim()) {
    return '';
  }

  try {
    const root = path.resolve(kb.dirPath);
    const files = await listKbFiles(root);
    const fingerprint = await computeFingerprint(files, kb.embedding.model);
    const cached = indexCache.get(root);
    const chunks = cached?.fingerprint === fingerprint ? cached.chunks : await buildIndex(root, kb.embedding);

    if (chunks.length === 0) {
      return '';
    }

    const [queryVector] = await embedTexts(kb.embedding, [question]);
    if (!queryVector) {
      return '';
    }

    const topK = Math.max(1, Math.min(20, Math.trunc(kb.topK || 1)));
    const ranked = chunks
      .map((chunk) => ({
        ...chunk,
        score: cosineSimilarity(queryVector, chunk.vector)
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, topK);

    return trimContext(
      ranked
        .map((chunk) => chunk.text)
        .join('\n\n')
        .trim(),
      maxChars
    );
  } catch {
    return '';
  }
}
