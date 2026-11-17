// Khoảng trống từ vựng: n-gram người tìm dùng nhiều hơn hẳn người viết, để admin biết nên thêm gì vào lexicon.
// So hai kho (log câu tìm và chỉ mục nội dung) bằng log-likelihood ratio G²
// (Dunning 1993; Rayson & Garside 2000 "Comparing Corpora using Frequency Profiling").
import { editDistance, maxEdits, type Understood } from './query.js';

/** Khoá tổng trong bảng đếm câu tìm: số câu, tổng unigram, tổng bigram (như ns `ngn` của chỉ mục). */
export const QUERY_TOTAL_KEYS = { queries: '#q', 1: '#1', 2: '#2' } as const;
export const MAX_SAMPLES = 5;

export interface QueryGrams {
  /** n-gram 1–2 engine chưa hiểu hết (đã bỏ trùng trong câu). */
  grams: string[];
  /** Tổng số vị trí n-gram của câu theo bậc, kể cả n-gram đã hiểu: mẫu số của tần suất, cùng cách đếm với chỉ mục. */
  totals: { 1: number; 2: number };
}

/**
 * n-gram 1–2 trên `seq` (đã bỏ dấu, bỏ ngân sách, số ngày, từ dừng và nơi đã hiểu), cùng cách tách với `ng` của chỉ mục.
 * Bỏ n-gram mà mọi từ đều thuộc cụm đã khớp lexicon: engine đã hiểu, không phải khoảng trống.
 */
export function queryGrams(u: Pick<Understood, 'seq' | 'matched'>): QueryGrams {
  const known = new Set(u.matched.flatMap(([phrase]) => phrase.split(' ')));
  const grams = new Set<string>();
  for (let k = 1; k <= 2; k++) {
    for (let i = 0; i + k <= u.seq.length; i++) {
      const ws = u.seq.slice(i, i + k);
      if (!ws.every((w) => known.has(w))) grams.add(ws.join(' '));
    }
  }
  return { grams: [...grams], totals: { 1: u.seq.length, 2: Math.max(0, u.seq.length - 1) } };
}

/**
 * G² của một n-gram: a lần trong A n-gram của câu tìm, c lần trong C n-gram của nội dung.
 * Chỉ tính khi người tìm dùng nhiều hơn người viết (a/A > c/C); ngược lại trả 0.
 */
export function keyness(a: number, A: number, c: number, C: number): number {
  if (!A || a / A <= (C ? c / C : 0)) return 0;
  const N = A + C;
  const term = (o: number, e: number) => (o > 0 ? o * Math.log(o / e) : 0);
  return 2 * (term(a, (A * (a + c)) / N) + term(c, (C * (a + c)) / N));
}

export interface QueryGramRow {
  gram: string;
  hits: number;
  samples: string[];
}

export interface VocabGap {
  /** Kiểu viết có điểm cao nhất trong nhóm. */
  gram: string;
  n: number;
  score: number;
  /** Tổng số câu tìm của cả nhóm. */
  queryHits: number;
  /** Số lần `gram` xuất hiện trong nội dung. */
  contentCount: number;
  variants: Array<{ gram: string; queryHits: number }>;
  samples: string[];
}

/**
 * Chấm G² cho từng n-gram rồi gom các kiểu viết gần nhau (cùng bậc, cách nhau tới maxEdits chữ) vào nhóm có điểm cao nhất.
 * ponytail: gom bằng so từng cặp, O(n²) trên vài nghìn n-gram; lớn hơn thì gom sẵn trong job.
 */
export function rankVocabGaps(
  rows: readonly QueryGramRow[],
  queryTotals: { 1: number; 2: number },
  content: { count: (gram: string) => number; totals: { 1: number; 2: number } },
): VocabGap[] {
  const scored = rows
    .map((r) => {
      const n = r.gram.split(' ').length as 1 | 2;
      const c = content.count(r.gram);
      return { ...r, n, c, score: keyness(r.hits, queryTotals[n], c, content.totals[n]) };
    })
    .filter((r) => r.score > 0)
    .sort((x, y) => y.score - x.score || y.hits - x.hits || (x.gram < y.gram ? -1 : 1));
  const groups: VocabGap[] = [];
  for (const r of scored) {
    const key = r.gram.replace(/ /g, '');
    const g = groups.find((x) => x.n === r.n && editDistance(x.gram.replace(/ /g, ''), key) <= maxEdits(key.length));
    if (!g) {
      groups.push({ gram: r.gram, n: r.n, score: r.score, queryHits: r.hits, contentCount: r.c, variants: [{ gram: r.gram, queryHits: r.hits }], samples: r.samples.slice(0, MAX_SAMPLES) });
      continue;
    }
    g.queryHits += r.hits;
    g.variants.push({ gram: r.gram, queryHits: r.hits });
    for (const s of r.samples) if (g.samples.length < MAX_SAMPLES && !g.samples.includes(s)) g.samples.push(s);
  }
  return groups;
}
