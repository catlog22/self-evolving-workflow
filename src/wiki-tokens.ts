// From TencentDB Agent Memory Wiki manager (MIT).
const STOP_WORDS = new Set([
  "的", "是", "了", "什么", "在", "有", "和", "与", "对", "从",
  "the", "is", "a", "an", "what", "how", "are", "was", "were",
  "do", "does", "did", "be", "been", "being", "have", "has", "had",
  "it", "its", "in", "on", "at", "to", "for", "of", "with", "by",
  "this", "that", "these", "those",
]);

export function tokenizeWiki(text: string): string[] {
  const rawTokens = text
    .toLowerCase()
    .split(/[\s,，。！？、；：""''（）()\-_/\\·~～…\[\]【】{}《》<>]+/)
    .filter((t) => t.length > 0);

  const result: string[] = [];
  for (const token of rawTokens) {
    const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(token);
    const hasLatin = /[a-z]/.test(token);

    if (hasCJK && hasLatin) {
      // 混合 token（如 "l0录入"）：拆分中英文部分分别处理
      const parts = token.split(/(?<=[a-z0-9])(?=[\u4e00-\u9fff])|(?<=[\u4e00-\u9fff])(?=[a-z0-9])/);
      for (const part of parts) {
        if (/[\u4e00-\u9fff]/.test(part) && part.length > 1) {
          const chars = [...part];
          for (let i = 0; i < chars.length - 1; i++) result.push(chars[i] + chars[i + 1]);
          result.push(part);
        } else if (part.length > 0 && !STOP_WORDS.has(part)) {
          result.push(part);
        }
      }
    } else if (hasCJK && token.length > 1) {
      // 纯中文：bigram
      const chars = [...token];
      for (let i = 0; i < chars.length - 1; i++) result.push(chars[i] + chars[i + 1]);
      result.push(token);
    } else if (!STOP_WORDS.has(token) && token.length > 0) {
      // 纯英文/数字：保留完整 token
      result.push(token);
    }
  }
  return result;
}
