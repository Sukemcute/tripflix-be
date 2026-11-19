import { PLACES } from '../../../search/domain/places.js';
import { accumulateInterest } from '../builders/trip-profile.js';
import { round4, type Candidate, type PostMeta, type Ranker } from '../contracts.js';
import { answerLive, type LiveAnswers, type Stage } from '../live-answers.js';
import { primaryPlace } from '../bins.js';
import { EXP_LABEL, type Exp } from '../topics.js';
import { sortByFinal, TRENDING, weightMap, type Scored } from './rankers.js';

/**
 * trip_v1 (TF28 v1, thiết kế v1 mục 3.5): gợi ý = trả lời câu hỏi du lịch.
 * Mỗi câu hỏi: khớp = cosine(histogram câu trả lời của người, ngăn của bài) có idf, nhân độ tin; cộng có trọng số theo giai đoạn.
 * Mọi hằng chỉnh được nằm ở đầu file. Đổi công thức chỉ sửa file này.
 */

type Part = 'exploring' | 'topic' | 'trip' | 'interestExp' | 'interestPlace' | 'fit' | 'global';

/**
 * Trọng số khởi điểm theo giai đoạn (chỉnh bằng bộ đo). trip âm ở "vừa về": hạ nơi vừa đi.
 * topic: chủ đề vừa tìm (biển, núi…), cộng thêm, không lấy bớt phần khác (19/11).
 */
const STAGE_WEIGHTS: Record<Stage, Record<Part, number>> = {
  dreaming: { exploring: 0, topic: 0.3, trip: 0, interestExp: 0.35, interestPlace: 0.2, fit: 0.1, global: 0.35 },
  planning: { exploring: 0.45, topic: 0.2, trip: 0, interestExp: 0.15, interestPlace: 0.05, fit: 0.15, global: 0.2 },
  upcoming: { exploring: 0, topic: 0.15, trip: 0.4, interestExp: 0.2, interestPlace: 0, fit: 0.1, global: 0.3 },
  on_trip: { exploring: 0, topic: 0.15, trip: 0.45, interestExp: 0.2, interestPlace: 0, fit: 0.05, global: 0.3 },
  after_trip: { exploring: 0, topic: 0.2, trip: -0.3, interestExp: 0.4, interestPlace: 0.1, fit: 0.1, global: 0.4 },
};
/** Điểm toàn cục = hot + đặt được ngay + đúng mùa; lên kế hoạch thì "đặt được ngay" nặng gấp đôi. */
const GLOBAL = { hot: 0.6, bookable: 0.25, season: 0.15 };
/** Độ tin đầy khi tổng trọng số dấu hiệu đạt mức này (thả tim = 2, lưu = 4; tìm = 1, tìm phòng = 3). */
const FULL_EVIDENCE = { interest: 10, exploring: 3, live: 1 };
/** Ngăn có ít bài hơn thì không tính khi so tầm giá / đi với ai / số ngày (chốt 18/11). */
const MIN_BIN_POSTS = 10;
/** Tương tác mới hơn mốc này chưa có trong gu dài hạn (job 10 phút): cộng thêm lúc gọi. */
const FRESH_MS = 15 * 60_000;
/** Sắp đi / đang đi: ở nơi đã đặt, bài về ăn chơi tại chỗ được nhiều hơn; bài khoe khách sạn khác bị hạ. */
const ON_SITE_EXP = new Set(['exp:an_uong', 'exp:cafe', 'exp:vui_choi', 'exp:ve_dem', 'exp:van_hoa']);
const OTHER_HOTEL_FACTOR = 0.5;
const NO_LOCAL_EXP_FACTOR = 0.6;

const placeName = (id: string) => PLACES.find((p) => p.id === id)?.name ?? id;
const ofQuestion = (m: Record<string, number>, q: string) => Object.fromEntries(Object.entries(m).filter(([b]) => b.startsWith(`${q}:`)));
const conf = (evidence: number | undefined, full: number) => Math.min(1, (evidence ?? 0) / full);
const SEASON_BY_MONTH = ['dong', 'xuan', 'xuan', 'xuan', 'he', 'he', 'he', 'he', 'thu', 'thu', 'thu', 'dong'];

function cosine(u: Record<string, number>, p: Record<string, number>, idf: Map<string, number>): number {
  let dot = 0;
  let nu = 0;
  let np = 0;
  for (const [b, w] of Object.entries(u)) nu += (w * (idf.get(b) ?? 0)) ** 2;
  for (const [b, w] of Object.entries(p)) {
    const i = idf.get(b) ?? 0;
    np += (w * i) ** 2;
    dot += (u[b] ?? 0) * i * w * i;
  }
  return nu > 0 && np > 0 ? dot / Math.sqrt(nu * np) : 0;
}

function mergeInto(target: Record<string, Record<string, number>>, add: Record<string, Record<string, number>>) {
  for (const [q, m] of Object.entries(add)) for (const [b, w] of Object.entries(m)) (target[q] ??= {})[b] = (target[q][b] ?? 0) + w;
}

/** Ngăn exp mạnh nhất mà người và bài cùng có; tránh "sống ảo" khi có lựa chọn khác (chốt 18/11). */
function bestSharedExp(u: Record<string, number>, p: Record<string, number>): string | null {
  const shared = Object.keys(p)
    .filter((b) => b.startsWith('exp:') && (u[b] ?? 0) > 0)
    .sort((a, b) => u[b]! * p[b]! - u[a]! * p[a]!);
  return shared.find((b) => b !== 'exp:song_ao') ?? shared[0] ?? null;
}
const expLabel = (bin: string) => EXP_LABEL[bin.slice(4) as Exp] ?? bin.slice(4);
const PARENT = new Map(PLACES.map((p) => [p.id, p.parentId]));

/** Nơi vừa tìm cũng nói lên chủ đề: chủ đề suy từ nơi nặng bằng chừng này so với tìm chủ đề trực tiếp. */
const PLACE_TOPIC_FACTOR = 0.5;
/** Nơi có ít bài hơn thì chưa đủ để nói nơi đó thiên về chủ đề gì. */
const MIN_PLACE_POSTS = 5;

/**
 * Nơi thiên về chủ đề nào, tính từ chính các bài của nơi đó (embed của tên nơi không biết Phú Quốc là biển, đo 19/11):
 * tỉ lệ ngăn exp trong bài của nơi trừ tỉ lệ chung của cả kho, chỉ giữ phần dương. Ăn uống có ở mọi nơi nên không nổi lên.
 */
function placeTopicProfiles(postBins: Iterable<Record<string, number>>): Map<string, Record<string, number>> {
  const perPlace = new Map<string, { posts: number; exps: Record<string, number>; total: number }>();
  const all: Record<string, number> = {};
  let allTotal = 0;
  for (const bins of postBins) {
    const exps = ofQuestion(bins, 'exp');
    const sum = Object.values(exps).reduce((a, b) => a + b, 0);
    for (const [e, w] of Object.entries(exps)) all[e] = (all[e] ?? 0) + w;
    allTotal += sum;
    for (const place of Object.keys(bins).filter((b) => b.startsWith('place:'))) {
      const p = perPlace.get(place) ?? { posts: 0, exps: {}, total: 0 };
      p.posts += 1;
      p.total += sum;
      for (const [e, w] of Object.entries(exps)) p.exps[e] = (p.exps[e] ?? 0) + w;
      perPlace.set(place, p);
    }
  }
  const profiles = new Map<string, Record<string, number>>();
  for (const [place, p] of perPlace) {
    if (p.posts < MIN_PLACE_POSTS || p.total === 0 || allTotal === 0) continue;
    const lift = Object.fromEntries(
      Object.entries(p.exps)
        .map(([e, w]) => [e, w / p.total - (all[e] ?? 0) / allTotal] as const)
        .filter(([, d]) => d > 0),
    );
    if (Object.keys(lift).length) profiles.set(place, lift);
  }
  return profiles;
}

/** Chủ đề suy từ các nơi đang tìm hiểu (đã có hệ số vừa xảy ra); bỏ tỉnh cha khi đã có nơi con để không đếm hai lần. */
function topicsFromPlaces(exploring: Record<string, number>, profiles: Map<string, Record<string, number>>): Record<string, number> {
  const parents = new Set(Object.keys(exploring).map((b) => PARENT.get(b.slice(6))).filter(Boolean).map((p) => `place:${p}`));
  const out: Record<string, number> = {};
  for (const [place, w] of Object.entries(exploring)) {
    if (parents.has(place)) continue;
    for (const [e, d] of Object.entries(profiles.get(place) ?? {})) out[e] = (out[e] ?? 0) + w * d;
  }
  return out;
}

/**
 * "Vì bạn đang tìm hiểu Nha Trang" khi bài ở đúng nơi đó. Bài chỉ khớp qua tỉnh cha (Cam Ranh khi người xem tìm Nha Trang)
 * thì nói "Gần Nha Trang mà bạn đang tìm hiểu", không nói tên tỉnh mà người xem chưa từng gõ.
 */
function exploringText(exploring: Record<string, number>, bins: Record<string, number>, place: string): string {
  // answerLive cộng cả tỉnh cha: bài ở cấp tỉnh khớp qua nơi con người xem đã tìm thì gọi tên nơi con đó.
  const child = Object.entries(exploring)
    .filter(([b]) => PARENT.get(b.slice(6)) === place && (bins[`place:${place}`] ?? 0) > 0)
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  return child ? `Gần ${placeName(child.slice(6))} mà bạn đang tìm hiểu` : `Vì bạn đang tìm hiểu ${placeName(place)}`;
}

/** Trải nghiệm chính của bài: ngăn exp có độ tin cao nhất (hoà thì theo tên, cố định). */
const mainExp = (bins: Record<string, number>) =>
  Object.entries(bins)
    .filter(([b]) => b.startsWith('exp:'))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

export const tripRankerV1: Ranker = {
  name: 'trip_v1',
  accepts: { postBuilders: ['post_profile@v1'], userBuilders: ['trip_profile@v1'] },
  // ponytail: đọc toàn bộ bài mỗi lượt gọi, ổn tới vài nghìn bài; lớn hơn thì lấy theo ngăn có index (thiết kế v1 mục 3.2).
  candidateLimit: 5000,
  needsViewerRows: true,
  rank({ candidates, userFeatures, now, viewer }) {
    const postBins = new Map(candidates.map((c) => [c.postId, weightMap(c.postFeatures.bins)]));
    // Nơi của tương tác tra cả bài ngoài ứng viên: Reels chỉ xếp video, nhưng thích bài viết Hà Nội vẫn là đang tìm hiểu Hà Nội.
    const metas: Record<string, PostMeta> = { ...viewer?.posts, ...Object.fromEntries(candidates.map((c) => [c.postId, c])) };

    // idf trên kho bài đang xét: ngăn ai cũng có (ăn uống, sống ảo) nhẹ đi.
    const df = new Map<string, number>();
    for (const bins of postBins.values()) for (const b of Object.keys(bins)) df.set(b, (df.get(b) ?? 0) + 1);
    const n = candidates.length;
    const idf = new Map([...df].map(([b, d]) => [b, Math.log((n + 1) / d) / Math.log(n + 1)]));

    // Câu trả lời dài hạn (job) + tương tác vài phút gần nhất chưa vào job.
    const answers: Record<string, Record<string, number>> = {};
    const evidence: Record<string, number> = {};
    mergeInto(answers, (userFeatures?.answers as Record<string, Record<string, number>> | undefined) ?? {});
    Object.assign(evidence, weightMap(userFeatures?.evidence));
    if (viewer) {
      const fresh = accumulateInterest(viewer.rows.filter((r) => now.getTime() - Date.parse(r.occurredAt) <= FRESH_MS), metas, now);
      mergeInto(answers, fresh.answers);
      for (const [q, w] of Object.entries(fresh.evidence)) evidence[q] = (evidence[q] ?? 0) + w;
    }
    const live: LiveAnswers | null = viewer ? answerLive({ rows: viewer.rows, posts: metas, productPlaces: viewer.productPlaces, now }) : null;
    // Chủ đề: gõ thẳng (biển, núi) + suy từ các nơi đang tìm hiểu (Nha Trang, Phú Quốc → biển), nặng bằng nửa.
    const topicVector: Record<string, number> = { ...live?.topics };
    if (live) {
      for (const [e, w] of Object.entries(topicsFromPlaces(live.exploring, placeTopicProfiles(postBins.values())))) {
        topicVector[e] = (topicVector[e] ?? 0) + PLACE_TOPIC_FACTOR * w;
      }
    }
    const topicEvidence = (live?.evidence.topics ?? 0) + PLACE_TOPIC_FACTOR * (live?.evidence.exploring ?? 0);

    const hasSignal =
      Object.keys(evidence).length > 0 || (live !== null && (live.stage !== 'dreaming' || live.evidence.exploring > 0 || live.evidence.topics > 0));
    if (!hasSignal) {
      return sortByFinal(
        candidates.map((c) => ({ candidate: c, final: c.score, item: { postId: c.postId, score: round4(c.score), source: c.source, breakdown: { global: round4(c.score), final: round4(c.score) }, reason: TRENDING } })),
      );
    }

    const stage: Stage = live?.stage ?? 'dreaming';
    const w = STAGE_WEIGHTS[stage];
    const season = `season:${SEASON_BY_MONTH[now.getUTCMonth()]}`;
    const fitQuestions: Array<[string, Record<string, number>, number]> = [
      ['cost', { ...ofQuestion(answers.cost ?? {}, 'cost'), ...live?.budget }, (evidence.cost ?? 0) / FULL_EVIDENCE.interest + (live?.evidence.budget ?? 0) / FULL_EVIDENCE.live],
      ['with', { ...ofQuestion(answers.with ?? {}, 'with'), ...live?.party }, (evidence.with ?? 0) / FULL_EVIDENCE.interest + (live?.evidence.party ?? 0) / FULL_EVIDENCE.live],
      ['len', { ...ofQuestion(answers.len ?? {}, 'len'), ...live?.len }, (evidence.len ?? 0) / FULL_EVIDENCE.interest + (live?.evidence.len ?? 0) / FULL_EVIDENCE.live],
    ];
    const tripBin = live?.trip ? `place:${live.trip.placeId}` : null;
    // Nơi được phép chiếm nhiều chỗ trong trang (feed-policy): nơi đang nhắm khi lên kế hoạch, nơi đã đặt khi sắp đi / đang đi.
    const focusBin =
      stage === 'planning'
        ? (Object.entries(live?.exploring ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null)
        : stage === 'upcoming' || stage === 'on_trip'
          ? tripBin
          : null;

    const scored: Scored[] = candidates.map((c: Candidate) => {
      const bins = postBins.get(c.postId)!;
      const places = ofQuestion(bins, 'place');
      const parts: Record<Part, number> = {
        exploring: conf(live?.evidence.exploring, FULL_EVIDENCE.exploring) * cosine(live?.exploring ?? {}, places, idf),
        trip: tripBin ? (bins[tripBin] ?? 0) * (stage === 'after_trip' || Object.keys(bins).some((b) => ON_SITE_EXP.has(b)) ? 1 : NO_LOCAL_EXP_FACTOR) : 0,
        topic: conf(topicEvidence, FULL_EVIDENCE.live) * cosine(topicVector, ofQuestion(bins, 'exp'), idf),
        interestExp: conf(evidence.exp, FULL_EVIDENCE.interest) * cosine(answers.exp ?? {}, ofQuestion(bins, 'exp'), idf),
        interestPlace: conf(evidence.place, FULL_EVIDENCE.interest) * cosine(answers.place ?? {}, places, idf),
        fit: 0,
        global: 0,
      };
      const fits = fitQuestions.flatMap(([q, u, e]) => {
        const p = Object.fromEntries(Object.entries(ofQuestion(bins, q)).filter(([b]) => (df.get(b) ?? 0) >= MIN_BIN_POSTS));
        return Object.keys(u).length && Object.keys(p).length ? [Math.min(1, e) * cosine(u, p, idf)] : [];
      });
      parts.fit = fits.length ? fits.reduce((a, b) => a + b, 0) / fits.length : 0;
      const bookable = typeof c.postFeatures.bookable === 'number' ? c.postFeatures.bookable : 0;
      parts.global = GLOBAL.hot * c.score + GLOBAL.bookable * bookable * (stage === 'planning' ? 2 : 1) + GLOBAL.season * (bins[season] ?? 0);

      let final = (Object.keys(parts) as Part[]).reduce((sum, k) => sum + w[k] * parts[k], 0);
      const postHotel = typeof c.postFeatures.hotelId === 'string' ? c.postFeatures.hotelId : null;
      const isOtherHotel = (stage === 'upcoming' || stage === 'on_trip') && tripBin && bins[tripBin] && postHotel && postHotel !== live!.trip!.hotelId;
      if (isOtherHotel) final *= OTHER_HOTEL_FACTOR;
      final = Math.max(0, final);

      // Lý do = thành phần dương góp nhiều nhất (chỉ dùng reason.code có sẵn trong API).
      const top = (['exploring', 'topic', 'trip', 'interestExp', 'interestPlace'] as Part[])
        .map((k) => ({ k, v: w[k] * parts[k] }))
        .filter((x) => x.v > 0)
        .sort((a, b) => b.v - a.v)[0];
      let reason = TRENDING;
      const place = primaryPlace(bins);
      const exp = bestSharedExp(answers.exp ?? {}, bins);
      if (top?.k === 'exploring' && place) reason = { code: 'matches_place', text: exploringText(live!.exploring, bins, place) };
      else if (top?.k === 'topic' && bestSharedExp(topicVector, bins)) {
        const topicExp = bestSharedExp(topicVector, bins)!;
        // Chủ đề gõ thẳng ("biển") thì "vừa tìm bài về"; chỉ suy từ nơi (Nha Trang, Phú Quốc…) thì nói theo nơi.
        reason = (live?.topics[topicExp] ?? 0) > 0
          ? { code: 'matches_interest', text: `Vì bạn vừa tìm bài về ${expLabel(topicExp)}` }
          : { code: 'matches_interest', text: `Vì bạn đang tìm hiểu các nơi có ${expLabel(topicExp)}` };
      } else if (top?.k === 'trip' && live?.trip) {
        const [, m, d] = live.trip.checkIn.split('-');
        reason = { code: 'matches_place', text: `Cho chuyến ${placeName(live.trip.placeId)} ${d}/${m} của bạn` };
      } else if (top?.k === 'interestExp' && exp) {
        reason = stage === 'after_trip' && live?.trip
          ? { code: 'matches_interest', text: `Bạn vừa đi ${placeName(live.trip.placeId)}, thử thêm bài về ${expLabel(exp)}` }
          : { code: 'matches_interest', text: `Vì bạn hay xem bài về ${expLabel(exp)}` };
      } else if (top?.k === 'interestPlace' && place) reason = { code: 'matches_place', text: `Vì bạn quan tâm ${placeName(place)}` };

      const breakdown = Object.fromEntries([...Object.entries(parts).map(([k, v]) => [k, round4(v)]), ['final', round4(final)]]);
      const diversity = { place, exp: mainExp(bins), isFocus: focusBin !== null && (bins[focusBin] ?? 0) > 0 };
      return { candidate: c, final, item: { postId: c.postId, score: round4(final), source: c.source, breakdown, reason, diversity } };
    });
    return sortByFinal(scored);
  },
};
