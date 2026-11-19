import { destOf } from '../../search/domain/explore/text.js';
import { normalizeText } from '../../search/domain/normalize-text.js';
import { PLACES, placeIdOfName } from '../../search/domain/places.js';
import { round4, type PostContent } from './contracts.js';
import { COST_PER_PERSON, costBin, EXP, EXP_DESCRIPTIONS, ITEM_CATEGORY_BINS, lenBin, PHRASE_BINS, TAG_BINS, TAG_PLACES } from './topics.js';

/** Những gì của bài dùng để xếp ngăn. Nhận thẳng PostMeta / PostBuildItem. Mọi trường trong content là tuỳ chọn: thiếu thì nguồn đó không góp. */
export interface PostBinInput {
  tags: string[];
  /** Nơi job đã suy (khách sạn gắn bài → tên nơi trong destinationName/tiêu đề), xem place-of-post.ts. */
  placeId: string | null;
  content?: PostContent;
}

/** Độ tin từng nguồn (recommend-topics mục 6, chốt 18/11). */
const W = { tag: 0.5, title: 0.5, body: 0.3, itemCategory: 0.5, cost: 0.5, days: 1, caption: 0.5 };
/**
 * Caption chỉ vào ngăn exp có cosine cao nhất khi hơn ngăn thứ hai ≥ biên này. Quét trên 283 caption thật (e5-small INT8,
 * bỏ hashtag; FP gồm cả caption không nói gì mà bị gán): 0,0075 cho F1 0,71 (precision 0,86, recall 0,61), gán bừa 14%.
 * F1 cao nhất là 0,0025 (0,75) nhưng gán bừa 59%; 0,02 gán bừa 2% nhưng F1 chỉ 0,52 (Duy chọn 0,0075, 19/11).
 */
const CAPTION_MARGIN = 0.0075;
/** Giới hạn văn bản của /embed. Mô hình chỉ đọc 256 token đầu nên phần sau không đổi kết quả. */
const CAPTION_MAX_CHARS = 2000;
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

/**
 * Ngăn chủ đề của câu tìm theo từ khoá. Khác caption: câu tìm chỉ là "biển", "núi" thì một âm tiết cũng tính
 * (cả câu trùng hashtag), vì không có ngữ cảnh khác để nhầm với "Biên Hoà".
 */
export function expsOfQuery(query: string): string[] {
  const whole = TAG_BINS[tagKey(query)] ?? [];
  return [...new Set([...binsInText(query), ...whole])].filter((b) => b.startsWith('exp:'));
}

/**
 * Câu tìm ngắn hơn caption nên điểm cosine sát nhau hơn: chỉ nhận ngăn gần nhất khi hơn ngăn thứ hai ≥ biên này.
 * Đo 19/11 trên 46 câu mẫu (eval/query-topics.samples.json) với CAPTION_MODEL: từ khoá bắt 23 câu, đúng cả 23; 23 câu còn lại
 * qua embed ở biên 0,01 gán 12 (đúng 11, sai 1), không gán câu mơ hồ nào; biên 0,005 gán thêm nhưng sai 2 và gán 1 câu mơ hồ.
 */
export const QUERY_MARGIN = 0.01;

/** Ngăn exp gần câu tìm nhất theo cosine, chỉ khi rõ (biên ≥ QUERY_MARGIN). */
export function queryExpOf(query: readonly number[], descriptions: readonly (readonly number[])[], margin = QUERY_MARGIN): string | null {
  const sorted = EXP.map((exp, i) => [`exp:${exp}`, (descriptions[i] ?? []).reduce((sum, x, j) => sum + x * (query[j] ?? 0), 0)] as const).sort((a, b) => b[1] - a[1]);
  return sorted.length > 1 && sorted[0]![1] - sorted[1]![1] >= margin ? sorted[0]![0] : null;
}

/** Văn bản nhúng của bài: tiêu đề + nội dung. Bài không có chữ thì null. */
export function captionOf(content: PostContent | undefined): string | null {
  const text = [content?.title, content?.body].filter(Boolean).join('\n').trim();
  return text ? Array.from(text).slice(0, CAPTION_MAX_CHARS).join('') : null;
}

/** Câu mô tả 9 ngăn exp, theo thứ tự EXP: job nhúng trước rồi so từng caption với chúng. */
export const EXP_DESCRIPTION_TEXTS: readonly string[] = EXP.map((exp) => EXP_DESCRIPTIONS[exp]);

/**
 * Ngăn exp gần caption nhất theo cosine, chỉ khi rõ (biên ≥ CAPTION_MARGIN). descriptions theo thứ tự EXP_DESCRIPTION_TEXTS.
 * Job gọi ngay khi đọc vector rồi bỏ vector: RAM chỉ giữ kết quả, không giữ 384 số mỗi bài.
 */
export function captionExpOf(caption: readonly number[], descriptions: readonly (readonly number[])[]): string | null {
  const scored = EXP.map((exp, i) => [`exp:${exp}`, descriptions[i]!.reduce((sum, x, j) => sum + x * caption[j]!, 0)] as const);
  const sorted = [...scored].sort((a, b) => b[1] - a[1]);
  return sorted[0]![1] - sorted[1]![1] >= CAPTION_MARGIN ? sorted[0]![0] : null;
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
  const captionBin = post.content?.captionExp;
  if (captionBin) addSource([captionBin], W.caption);
  if (trip) {
    addSource(trip.items.flatMap((i) => (i.category && ITEM_CATEGORY_BINS[i.category] ? [ITEM_CATEGORY_BINS[i.category]!] : [])), W.itemCategory);
    if (trip.estimatedCostPerPerson) addSource([costBin(trip.estimatedCostPerPerson, COST_PER_PERSON)], W.cost);
    if (trip.daysCount) addSource([lenBin(trip.daysCount)], W.days);
  }
  for (const [bin, w] of score) if (w >= BIN_THRESHOLD) out[bin] = round4(Math.min(1, w));
  return out;
}

/**
 * Nơi chính = nơi cụ thể nhất của bài (Nha Trang chứ không phải Khánh Hoà).
 * Không dựa vào thứ tự khoá: jsonb của Postgres tự sắp lại khoá nên 'place:khanh-hoa' có thể đứng trước.
 */
export function primaryPlace(bins: Record<string, number>): string | null {
  const ids = Object.keys(bins).filter((b) => b.startsWith('place:')).map((b) => b.slice(6));
  const parents = new Set(ids.map((id) => PARENT.get(id)));
  return ids.find((id) => !parents.has(id)) ?? ids[0] ?? null;
}
