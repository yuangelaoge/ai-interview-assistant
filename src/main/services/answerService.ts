import crypto from 'node:crypto';
import type { AnswerResult, AudioChunkPayload, AsrResult, DeepAnswerResult } from '../../shared/types';
import { clampSentences } from '../utils/text';
import { answerLanguageDirective } from '../utils/language';
import { getConfig } from './configStore';
import { generateDeepAnswer, generateDeepContextAnswer } from './deepAnswerAgent';
import { loadShallowContext } from './shallowContext';
import { chatCompletion, transcribeWithOpenAiCompatibleApi } from './openAiCompatible';
import { transcribeWithVolcengineAucFlash } from './volcengineAsr';
import { transcribeWithVolcengineSauc } from './volcengineSaucAsr';
import { transcribeWithMacosSpeech } from './macosSpeechAsr';
import { retrieveKnowledge } from './knowledgeBase';

export async function transcribeAudio(payload: AudioChunkPayload): Promise<AsrResult> {
  const config = getConfig();
  let text = '';

  if (config.asr.provider === 'volcengine-sauc-stream') {
    text = await transcribeWithVolcengineSauc(config.asr.volcengineSauc, payload);
  } else if (config.asr.provider === 'volcengine-auc-flash') {
    text = await transcribeWithVolcengineAucFlash(config.asr.volcengine, payload);
  } else if (config.asr.provider === 'macos-speech') {
    text = await transcribeWithMacosSpeech(payload);
  } else {
    text = await transcribeWithOpenAiCompatibleApi(config.asr.openai, payload, { language: config.asr.language });
  }

  return {
    text,
    timestamp: Date.now(),
    confidence: text ? 0.88 : 0
  };
}

export async function generateFastAnswer(question: string): Promise<string> {
  const config = getConfig();
  const isContextMode = config.fastAnswerMode === 'context';
  const shallowContext = isContextMode
    ? await loadShallowContext(config.shallowDocsPath, 10000)
    : '当前为零上下文模式：不要假设简历、JD、项目或代码细节，只基于问题本身给出稳妥的通用回答。';
  const kbContext = await retrieveKnowledge(question, config.knowledgeBase, 6000);
  const fullContext = kbContext ? `【知识库检索片段】\n${kbContext}\n\n${shallowContext}` : shallowContext;
  const content = await chatCompletion(
    config.fastModel,
    [
      {
        role: 'system',
        content:
          '你是实时面试快答助手，负责双层回答架构里的第一层“先救场”。你的输出会被候选人直接照着说，所以必须像候选人本人正在回答面试官，使用第一人称“我”，直接回答问题本身。后面还会有深答模型补充完整细节，因此你只给2到4句话的口语化短答案，先说结论、再补一两个关键依据或项目表达。优先依据用户提供的简历/JD/项目资料；资料不足时也要给保守但可直接开口的回答，不能让面试官补充问题。禁止输出答题建议、方法论指导、标题、项目符号、反问句、寒暄、免责声明，以及“这个问题可以...”“可以顺着...”“您方便再补充...”这类元话术。' +
          '\n\n' +
          answerLanguageDirective(config.answerLanguage)
      },
      {
        role: 'user',
        content: `快答模式：${isContextMode ? '上下文模式，最多使用约 10k 字符浅层资料' : '零上下文模式'}\n\n浅层资料：\n${fullContext}\n\n面试官问题：\n${question}\n\n请直接生成候选人可口述的第一人称回答，不要解释应该怎么回答，也不要反问面试官。`
      }
    ],
    {
      temperature: 0.25,
      maxTokens: 260,
      thinking: config.fastModel.baseURL.includes('api.deepseek.com') ? 'disabled' : undefined
    }
  );

  return sanitizeFastAnswer(content);
}

export async function translateText(text: string, target: 'zh' = 'zh'): Promise<string> {
  const source = text.trim();

  if (!source) {
    return '';
  }

  const config = getConfig();
  const content = await chatCompletion(
    config.fastModel,
    [
      {
        role: 'system',
        content: '你是翻译助手。把用户提供的文本翻译成简体中文，只输出翻译结果，不要解释、不要加引号。'
      },
      {
        role: 'user',
        content: source
      }
    ],
    {
      temperature: 0.2,
      maxTokens: 400
    }
  );

  return content.trim();
}

export async function generateDeepAnswerForQuestion(
  question: string,
  options: {
    onDelta?: (delta: string) => void;
  } = {}
): Promise<DeepAnswerResult> {
  const config = getConfig();
  if (config.deepAnswerMode === 'context') {
    return generateDeepContextAnswer(config.deepModel, question, config.deepContextPath, options);
  }

  return generateDeepAnswer(config.deepModel, question, config.codeWorkspacePath, options);
}

export async function confirmQuestion(question: string): Promise<AnswerResult> {
  const now = Date.now();
  const fastAnswer = await generateFastAnswer(question);

  return {
    id: crypto.randomUUID(),
    question,
    fastAnswer,
    fastStatus: 'ready',
    deepStatus: 'thinking',
    createdAt: now,
    updatedAt: Date.now()
  };
}

function sanitizeFastAnswer(content: string): string {
  const cleaned = content
    .replace(/^(这个问题|这道题|这类问题)(可以|建议|应该|适合)[，,、\s]*/g, '')
    .replace(/^(你可以|候选人可以|可以先|建议先|回答时可以)[，,、\s]*/g, '')
    .replace(/您方便再补充一下[^。！？!?]*[。！？!?]?/g, '')
    .replace(/方便再补充一下[^。！？!?]*[。！？!?]?/g, '')
    .replace(/请.*?补充[^。！？!?]*[。！？!?]?/g, '')
    .trim();

  return clampSentences(cleaned || content, 4);
}
