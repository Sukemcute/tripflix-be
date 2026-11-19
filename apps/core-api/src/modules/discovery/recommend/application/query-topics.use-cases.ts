import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EXP_DESCRIPTION_TEXTS, expsOfQuery, queryExpOf } from '../domain/bins.js';
import { CAPTION_MODEL } from '../domain/topics.js';
import { RECOMMEND_STORE, TEXT_EMBEDDER, type RecommendStore, type TextEmbedder } from './ports.js';

/** Nhúng câu tìm chậm quá chừng này thì bỏ: sự kiện tìm kiếm không chờ lâu. */
const EMBED_TIMEOUT_MS = 2_000;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Đường đi của một lần xếp ngăn, ghi vào log `recommend.query_topics` để biết embed có chạy không. */
type TopicSource = 'keyword' | 'embed' | 'embed_unclear' | 'embed_failed' | 'embed_timeout' | 'no_embedder';

/**
 * Ngăn chủ đề của câu tìm (biển, núi, ăn uống…) cho gợi ý. Từ khoá trước; không ra ngăn nào thì nhúng câu tìm qua
 * ai-service và so với câu mô tả ngăn. Gọi sau khi đã trả kết quả tìm (chạy nền). Lỗi, chậm, chưa nối ai-service: trả [].
 * Vector cache theo hash trong recommend_text_vectors (không lưu câu tìm).
 */
@Injectable()
export class QueryTopicUseCases {
  private readonly logger = new Logger(QueryTopicUseCases.name);

  constructor(
    @Inject(RECOMMEND_STORE) private readonly store: RecommendStore,
    @Optional() @Inject(TEXT_EMBEDDER) private readonly embedder?: TextEmbedder,
  ) {}

  async classify(query: string): Promise<string[]> {
    const startedAt = Date.now();
    const done = (source: TopicSource, exps: string[]) => {
      // Không ghi câu tìm: chỉ đường đi, ngăn ra được và thời gian.
      this.logger.log({ source, exps, ms: Date.now() - startedAt }, 'recommend.query_topics');
      return exps;
    };
    const byKeyword = expsOfQuery(query);
    if (byKeyword.length) return done('keyword', byKeyword);
    if (!this.embedder) return done('no_embedder', []);
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), EMBED_TIMEOUT_MS).unref?.());
    const vectors = await Promise.race([this.vectorsOf([...EXP_DESCRIPTION_TEXTS, query.trim()]), timeout]).catch(() => null);
    if (vectors === 'timeout') return done('embed_timeout', []);
    if (!vectors) return done('embed_failed', []);
    const [queryVector, ...descriptions] = [query.trim(), ...EXP_DESCRIPTION_TEXTS].map((t) => vectors.get(t));
    if (!queryVector || descriptions.some((d) => !d)) return done('embed_failed', []);
    const exp = queryExpOf(queryVector, descriptions as number[][]);
    return exp ? done('embed', [exp]) : done('embed_unclear', []);
  }

  /** Như job đặc trưng: đọc cache, thiếu thì nhúng rồi ghi cache. Vector của mô hình khác CAPTION_MODEL thì bỏ. */
  private async vectorsOf(texts: string[]): Promise<Map<string, number[]> | null> {
    const hashes = texts.map(sha256);
    const byHash = await this.store.findTextVectors(CAPTION_MODEL, [...new Set(hashes)]);
    const missing = [...new Set(texts.filter((_, i) => !byHash.has(hashes[i]!)))];
    if (missing.length) {
      const embedded = await this.embedder!.embed(missing);
      if (embedded?.model !== CAPTION_MODEL) return null;
      const rows = missing.map((t, i) => ({ textHash: sha256(t), vector: embedded.vectors[i]! }));
      await this.store.insertTextVectors(CAPTION_MODEL, rows);
      for (const r of rows) byHash.set(r.textHash, r.vector);
    }
    return new Map(texts.flatMap((t, i) => (byHash.has(hashes[i]!) ? [[t, byHash.get(hashes[i]!)!] as const] : [])));
  }
}
