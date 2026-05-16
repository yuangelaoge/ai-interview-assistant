export function isLikelyQuestion(text: string): boolean {
  const normalized = text.trim();

  if (!normalized) {
    return false;
  }

  return (
    /[?？]/.test(normalized) ||
    /(什么|怎么|如何|为什么|是否|能不能|可不可以|请介绍|说一下|讲一下|解释|区别|原理|遇到|负责|难点|亮点)/.test(
      normalized
    ) ||
    /\b(what|why|how|when|where|which|could|would|can|tell me|explain|describe)\b/i.test(normalized)
  );
}

export function normalizeQuestion(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
