import { destOf } from '../../search/domain/explore/text.js';
import { normalizeText } from '../../search/domain/normalize-text.js';
import { PLACES, placeIdOfName } from '../../search/domain/places.js';
import { round4, type PostContent } from './contracts.js';
import { COST_PER_PERSON, costBin, ITEM_CATEGORY_BINS, lenBin, PHRASE_BINS, TAG_BINS, TAG_PLACES } from './topics.js';

/** Những gì của bài dùng để xếp ngăn. Nhận thẳng PostMeta / PostBuildItem. Mọi trường trong content là tuỳ chọn: thiếu thì nguồn đó không góp. */
export interface PostBinInput {
  tags: string[];
  /** Nơi job đã suy (khách sạn gắn bài → tên nơi trong destinationName/tiêu đề), xem place-of-post.ts. */
  placeId: string | null;
  content?: PostContent;
}

/** Độ tin từng nguồn (recommend-topics mục 6, chốt 18/11). */
const W = { tag: 0.5, title: 0.5, body: 0.3, itemCategory: 0.5, cost: 0.5, days: 1 };
/** Ngăn exp/cost/with/len/season chỉ giữ khi tổng độ tin ≥ ngưỡng: một nguồn mạnh là đủ, nội dung một mình thì không. */
export const BIN_THRESHOLD = 0.5;

const PARENT = new Map(PLACES.map((p) => [p.id, p.parentId]));
const tagKey = (t: string) => normalizeText(t).replace(/ /g, '');
/**
 * Chữ ghép nhiều âm tiết ("vanhoa", "streetfood") mới coi là hashtag viết liền trong câu.
 * Một âm tiết ("bien", "nui") thì có thể là chữ thường sau khi bỏ dấu (Biên Hoà, nụ cười): để cụm từ PHRASE_BINS lo.
 */
const isCompoundWord = (word: string) => (word.match(/[aeiouy]+/g)?.length ?? 0) > 1;

/** Ngăn mà một đoạn chữ nhắc tới: cụm từ theo ranh giới từ, và từng chữ trùng hashtag rõ nghĩa ("vanhoa" trong tiêu đề seed). */
function binsInText(text: string): Set<string> {
  const norm = normalizeText(text);
  if (!norm) return new Set();
  const padded = ` ${norm} `;
  const found = new Set<string>();
  for (const [bin, phrases] of Object.entries(PHRASE_BINS)) if (phrases.some((p) => padded.includes(` ${p} `))) found.add(bin);
  for (const word of norm.split(' ')) if (isCompoundWord(word)) for (const bin of TAG_BINS[word] ?? []) found.add(bin);
  return found;
}

/** Nơi chính của bài và độ tin: nguồn có thứ tự cao hơn thắng (recommend-topics mục 6.2). */
function placeOf(post: PostBinInput): { placeId: string; w: number } | null {
  if (post.placeId) return { placeId: post.placeId, w: post.content?.trip?.hotelId ? 1 : 0.9 };
  for (const t of post.tags) {
    const placeId = TAG_PLACES[tagKey(t)];
    if (placeId) return { placeId, w: 0.8 };
  }
  const texts = [post.content?.body ?? '', ...(post.content?.trip?.items ?? []).map((i) => i.location ?? '')];
  for (const text of texts) {
    const name = text ? destOf(text) : null;
    const placeId = name ? placeIdOfName(name) : null;
    if (placeId) return { placeId, w: 0.6 };
  }
  return null;
}

/**
 * Xếp một bài vào ngăn: { 'place:nha-trang': 0.9, 'place:khanh-hoa': 0.9, 'exp:bien': 1, … }.
 * Nơi: một nơi chính + tỉnh cha cùng độ tin. Ngăn khác: cộng độ tin các nguồn có nhắc (mỗi nguồn tính một lần), chặn ở 1.
 * Bài không có tín hiệu rõ thì không vào ngăn nào: không cố phân loại bài rác.
 */
export function assignBins(post: PostBinInput): Record<string, number> {
  const out: Record<string, number> = {};

  const place = placeOf(post);
  if (place) {
    out[`place:${place.placeId}`] = place.w;
    const parent = PARENT.get(place.placeId);
    if (parent) out[`place:${parent}`] = place.w;
  }

  const score = new Map<string, number>();
  const addSource = (bins: Iterable<string>, w: number) => {
    for (const bin of new Set(bins)) score.set(bin, (score.get(bin) ?? 0) + w);
  };
  addSource(post.tags.flatMap((t) => TAG_BINS[tagKey(t)] ?? []), W.tag);
  const { title, body, trip } = post.content ?? {};
  if (title) addSource(binsInText(title), W.title);
  if (body) addSource(binsInText(body), W.body);
  if (trip) {
    addSource(trip.items.flatMap((i) => (i.category && ITEM_CATEGORY_BINS[i.category] ? [ITEM_CATEGORY_BINS[i.category]!] : [])), W.itemCategory);
    if (trip.estimatedCostPerPerson) addSource([costBin(trip.estimatedCostPerPerson, COST_PER_PERSON)], W.cost);
    if (trip.daysCount) addSource([lenBin(trip.daysCount)], W.days);
  }
  for (const [bin, w] of score) if (w >= BIN_THRESHOLD) out[bin] = round4(Math.min(1, w));
  return out;
}
