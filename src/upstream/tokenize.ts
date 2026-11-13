// Derived from TencentDB Agent Memory MemoryCore/src/core/store/tokenize.ts (MIT).
import { Jieba } from '@node-rs/jieba';
import { dict } from '@node-rs/jieba/dict.js';

const jieba = Jieba.withDict(dict);
export const ZH_STOP_WORDS = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
  "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着",
  "没有", "看", "好", "自己", "这", "他", "她", "它", "们", "那",
  "吗", "吧", "呢", "啊", "呀", "哦", "嗯",
]);

export function buildFtsQuery(text: string): string | null {
  const words = jieba.cutForSearch(text, true)
    .map(word => word.trim())
    .filter(word => /[\p{L}\p{N}]/u.test(word) && !ZH_STOP_WORDS.has(word));
  const terms = [...new Set(words)].map(word => `"${word.replaceAll('"', '""')}"`);
  return terms.length ? terms.join(' OR ') : null;
}

export function tokenizeForFts(text: string): string {
  return jieba.cutForSearch(text, true).join(' ');
}

export function bm25RankToScore(rank: number): number {
  if (!Number.isFinite(rank)) return 1 / (1 + 999);
  if (rank < 0) {
    const relevance = -rank;
    return relevance / (1 + relevance);
  }
  return 1 / (1 + rank);
}
