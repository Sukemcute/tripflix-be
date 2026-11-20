import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@tripflix/db';
import { calculateCompleteness } from '../domain/completeness.js';
import { calculateHotRaw, HOT_CANDIDATE_DAYS, normalizeHotScores } from '../domain/hot-trend.js';
import { TREND_SCORE_STORE, type TrendScoreStore } from './ports.js';

export interface HotScore {
  /** Trong [0, 1], cùng thang với hot@v2 của discovery. */
  score: number;
  computedAt: string;
}

/** Chấm điểm Hot cho bài video đăng trong 30 ngày (TF111) và cho module khác đọc điểm. */
@Injectable()
export class TrendScoresUseCases {
  constructor(@Inject(TREND_SCORE_STORE) private readonly store: TrendScoreStore) {}

  /**
   * Chấm lại toàn bộ bài ứng viên rồi thay cả bảng trong một transaction, để người đọc không thấy bảng nửa cũ nửa mới.
   * Trả số bài đã chấm.
   */
  @Transactional('content')
  async recompute(now = new Date()): Promise<number> {
    const since = new Date(now.getTime() - HOT_CANDIDATE_DAYS * 86_400_000);
    const candidates = await this.store.listHotCandidates({ now, since });
    const scored = normalizeHotScores(
      candidates.map((candidate) => {
        const completeness = calculateCompleteness({
          mediaIds: candidate.mediaIds,
          coverMediaId: candidate.coverMediaId,
          body: candidate.body,
          hashtags: candidate.hashtags,
          tripAttachment: candidate.tripAttachment,
        });
        return {
          postId: candidate.postId,
          raw: calculateHotRaw(candidate.decayedSignal, completeness),
          decayedSignal: candidate.decayedSignal,
          completeness,
        };
      }),
    );
    await this.store.replaceScores(scored, now);
    return scored.length;
  }

  /** Điểm Hot của các bài có trong bảng; bài ngoài 30 ngày hoặc chưa được chấm thì không có trong Map. */
  async getScores(postIds: string[]): Promise<Map<string, HotScore>> {
    const rows = await this.store.findScores([...new Set(postIds)]);
    return new Map(rows.map((row) => [row.postId, { score: row.score, computedAt: row.computedAt }]));
  }
}
