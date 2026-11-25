import { placeBucketOfId } from '../../search/domain/places.js';
import { escapeTypesenseFilterValue, TypesenseClient, type TypesenseSearchRequest } from '../../search/infra/typesense.client.js';
import type { TasteQuery, TasteRetrieval } from '../application/ports.js';

/** Tag gắn theo trào lưu, không nói gì về gu (đo trên recommend_user_features 25/11): bỏ để không kéo bài ngẫu nhiên. */
const NOISE_TAGS = new Set(['fyp', 'xuhuong', 'trending', 'tiktok', 'viral', 'foryou', 'foryoupage', 'ancungtiktok', 'learnontiktok', 'vlog', 'review', 'checkin']);

const list = (field: string, values: readonly string[]) => `${field}:=[${values.map(escapeTypesenseFilterValue).join(',')}]`;

/** Vertical của chỉ mục explore chứa bài: video, còn lại (bài, lộ trình) ở plans. */
function verticalFilter(postType: string | null): string {
  if (postType === 'video') return 'vertical:=`videos`';
  if (postType) return 'vertical:=`plans`';
  return 'vertical:=[`plans`,`videos`]';
}

/**
 * Nguồn ứng viên theo gu cho recommend, đọc cùng chỉ mục Typesense với tìm khám phá: mỗi nguồn (nơi, tag) một search
 * trong một `multi_search`, chỉ xin `id`. Không lọc bài đã xem: feed-policy hạ điểm (quyết định 16/11).
 */
export class TypesenseTasteRetrieval implements TasteRetrieval {
  constructor(
    private readonly client: TypesenseClient,
    private readonly alias = 'explore',
  ) {}

  async findPostIds(q: TasteQuery): Promise<string[]> {
    const vertical = verticalFilter(q.postType) + (q.hasPlan ? ' && sections:=[`plan`]' : '');
    const places = q.places.flatMap((id) => placeBucketOfId(id) ?? []);
    const tags = q.tags.filter((t) => !NOISE_TAGS.has(t));
    const searches: TypesenseSearchRequest[] = [];
    const page = { q: '*', include_fields: 'id', sort_by: 'quality_score:desc,created_at:desc', per_page: q.limitPerSource };
    if (places.length) searches.push({ ...page, filter_by: `${vertical} && ${list('place_buckets', places)}` });
    // Tag người dùng (hashtag) hoặc chủ đề trải nghiệm (exp: nui, bien…): khớp hashtag hoặc token đã chuẩn hoá của bài.
    if (tags.length) searches.push({ ...page, filter_by: `${vertical} && (${list('tags_folded', tags)} || ${list('terms', tags)})` });
    if (!searches.length) return [];

    const results = await this.client.multiSearch<{ id: string }>(searches, { collection: this.alias });
    const ids = new Set<string>();
    for (const res of results) {
      if (res.error) throw new Error(`Typesense nguồn gu lỗi: ${res.error}`);
      for (const hit of res.hits ?? []) if (hit.document.id.startsWith('post:')) ids.add(hit.document.id.slice('post:'.length));
    }
    return [...ids];
  }
}
