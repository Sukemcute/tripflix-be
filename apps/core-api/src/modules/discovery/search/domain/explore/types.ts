// Kiểu dữ liệu chung của engine tìm khám phá.

export type ExploreKind = 'food' | 'cafe' | 'see' | 'stay' | 'plan' | 'post' | 'video';

/** Một thứ tìm được (khách sạn, bài, video, quán...). Map từ dữ liệu module khác trong application/. */
export interface ExploreObject {
  id: string;
  kind: ExploreKind;
  title: string;
  text?: string;
  area?: string | null;
  addr?: string | null;
  /** Nơi theo lexicon (vd 'Đà Lạt'). */
  place?: string | null;
  lat?: number | null;
  lon?: number | null;
  rating?: number | null;
  /** Số review / bình luận. */
  n?: number | null;
  /** Review mô phỏng: không đưa vào thống kê cụm. */
  sim?: boolean;
  src?: string | null;
  views?: number | null;
  likes?: number | null;
  topics?: string[];
  subtype?: string | null;
  days?: number | null;
  /** Chi phí mỗi người (lộ trình). */
  cost?: number | null;
  /** Giá một đêm (chỗ ở). */
  priceNight?: number | null;
  priceSim?: boolean;
  stars?: number | null;
  /** Mã gốc ở module nguồn (mã khách sạn, mã bài). */
  refId?: string;
  /** Khách sạn: mã trên URL trang chi tiết. Chỉ mục dựng trước khi có field này thì không có. */
  slug?: string | null;
  thumbnail?: string | null;
  /** Bài: id tác giả, ngày đăng (ISO) và điểm hoàn thiện 0..1. Chỉ mục dựng trước khi có field này thì không có. */
  authorId?: string | null;
  createdAt?: string | null;
  completeness?: number | null;
}

/** Một tài liệu trong chỉ mục của một nhánh. */
export interface IndexedDoc {
  id: string;
  vertical: string;
  /** Thứ tự thêm vào chỉ mục: giữ thứ tự xếp ổn định khi bằng điểm. */
  ord: number;
  obj: ExploreObject;
  tf: Record<string, number>;
  dl: number;
  /** Dạng có dấu của tài liệu tiếng Việt; null = tài liệu không dấu (không bắt đúng dấu). */
  acc: string[] | null;
  streets: string[];
  tier: readonly [string, number] | null;
}

export interface CountRow {
  ns: string;
  key: string;
  n: number;
}

/** Điều kiện lấy ứng viên của một nhánh. Phải là tập cha của mọi tài liệu mà bước chấm điểm chấp nhận. */
export interface CandidateFilter {
  vertical: string;
  /** Không có từ tìm: lấy mọi tài liệu (chỉ lọc nơi), tối đa ALL_LIMIT dòng đầu theo ord. */
  isAll: boolean;
  terms: string[];
  names: string[];
  tiers: string[];
  days: number | null;
  place: string | null;
  /** Các bucket coi là đúng nơi (bucketsWithin(place)): tìm một tỉnh thì gồm cả điểm đến con. */
  places: string[];
  /** Token (trong tf) của mọi bí danh của place: bài chưa rõ nơi chứa một trong số này là ứng viên (rank kiểm khớp đủ bí danh).
   * Câu có từ (!isAll): mọi bài chưa rõ nơi là ứng viên. */
  placeTerms: string[];
  center: { lat: number; lon: number } | null;
  /** Nửa bề rộng khung vĩ độ quanh center. */
  latSpan: number;
}

/** Nguồn chỉ mục: Postgres (infra) hoặc RAM (test, so với bản Python). */
export interface ExploreSource {
  counts(keys: ReadonlyArray<{ ns: string; key: string }>): Promise<CountRow[]>;
  /** Từ đơn trong chỉ mục (df chung) bắt đầu bằng `first`, độ dài trong [minLen, maxLen]. */
  typoPool(first: string, minLen: number, maxLen: number): Promise<Array<{ term: string; df: number }>>;
  /** Cụm nhiều từ (tên đường, chuỗi, cụm trong tiêu đề) bắt đầu bằng `first`; độ dài SAU KHI bỏ khoảng trắng trong [minLen, maxLen]. */
  phrasePool(first: string, minLen: number, maxLen: number): Promise<string[]>;
  /** Tài liệu của một nhánh, theo `ord` tăng dần; isAll thì chỉ ALL_LIMIT dòng đầu. */
  candidates(filter: CandidateFilter): Promise<IndexedDoc[]>;
}

export interface BuiltIndex {
  docs: IndexedDoc[];
  counts: CountRow[];
}
