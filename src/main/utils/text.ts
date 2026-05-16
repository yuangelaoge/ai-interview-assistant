export function isLikelyQuestion(text: string): boolean {
  const normalized = text.trim();

  if (!normalized) {
    return false;
  }

  const questionMarks = /[?？]/.test(normalized);
  const cnQuestionWords = /(什么|怎么|如何|为什么|是否|能不能|可不可以|请介绍|说一下|讲一下|解释|区别|原理|遇到|负责|难点|亮点)/.test(
    normalized
  );
  const enQuestionWords = /\b(what|why|how|when|where|which|could|would|can|tell me|explain|describe)\b/i.test(
    normalized
  );

  return questionMarks || cnQuestionWords || enQuestionWords;
}

export function trimContext(input: string, maxChars: number): string {
  if (input.length <= maxChars) {
    return input;
  }

  const head = input.slice(0, Math.floor(maxChars * 0.65));
  const tail = input.slice(-Math.floor(maxChars * 0.25));
  return `${head}\n\n[...中间内容已压缩省略...]\n\n${tail}`;
}

export function clampSentences(input: string, maxSentences = 4): string {
  const parts = input
    .split(/(?<=[。！？!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length <= maxSentences) {
    return input.trim();
  }

  return parts.slice(0, maxSentences).join('');
}
