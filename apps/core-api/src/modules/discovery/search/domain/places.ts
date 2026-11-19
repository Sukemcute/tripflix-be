import { normalizeText } from './normalize-text.js';

/**
 * Cây địa điểm v1: 34 tỉnh, thành sau sáp nhập 2025 và các điểm đến mà danh mục commerce dùng làm provinceSlug.
 * id trùng provinceSlug của commerce, nên khách sạn gắn thẳng vào nút này.
 * ponytail: chỉ tới cấp tỉnh + điểm đến, chưa có xã/phường và bán kính vì commerce chưa có toạ độ.
 */
export interface PlaceSeed {
  id: string;
  name: string;
  kind: 'province' | 'destination';
  /** Điểm đến thuộc tỉnh nào; tỉnh thì null. */
  parentId: string | null;
  /** Tên gọi khác (dạng bỏ dấu và viết liền được tự sinh); dùng cả trong câu tìm lẫn văn bản bài viết. */
  aliases: string[];
  /** Viết tắt ngắn dễ trùng ('hn', 'sg', 'dn'…): chỉ dùng cho câu tìm, gợi ý và DB aliases, không đọc từ văn bản bài viết. */
  queryOnly?: string[];
  /** Địa danh / thắng cảnh nổi tiếng gắn với nơi này ('cau rong', 'royal city'…): nhận ra trong bài viết/tag, không biến thành nơi của LEX tìm khám phá. */
  landmarks?: string[];
  /** Nhóm nơi trên tìm khám phá nếu hai nút PLACES gộp chung một bucket (chỉ 'ho-chi-minh' → 'Sài Gòn'). */
  exploreBucket?: string;
}

type PlaceExtra = Partial<Pick<PlaceSeed, 'aliases' | 'queryOnly' | 'landmarks' | 'exploreBucket'>>;

const province = (id: string, name: string, extra: PlaceExtra = {}): PlaceSeed => ({
  id,
  name,
  kind: 'province',
  parentId: null,
  aliases: extra.aliases ?? [],
  ...(extra.queryOnly ? { queryOnly: extra.queryOnly } : {}),
  ...(extra.landmarks ? { landmarks: extra.landmarks } : {}),
  ...(extra.exploreBucket ? { exploreBucket: extra.exploreBucket } : {}),
});

const destination = (id: string, name: string, parentId: string, extra: PlaceExtra = {}): PlaceSeed => ({
  id,
  name,
  kind: 'destination',
  parentId,
  aliases: extra.aliases ?? [],
  ...(extra.queryOnly ? { queryOnly: extra.queryOnly } : {}),
  ...(extra.landmarks ? { landmarks: extra.landmarks } : {}),
  ...(extra.exploreBucket ? { exploreBucket: extra.exploreBucket } : {}),
});

/** Tự sinh biến thể bỏ dấu và viết liền (vd 'Hà Giang' → ['ha giang', 'hagiang']). */
export function placeVariants(raw: string): string[] {
  const spaced = normalizeText(raw);
  if (!spaced) return [];
  const joined = spaced.replace(/ /g, '');
  return joined !== spaced ? [spaced, joined] : [spaced];
}

/** Toàn bộ bí danh tìm kiếm (gồm cả viết tắt queryOnly) để nạp DB places.aliases và chỉ mục gợi ý. */
export const searchAliasesOf = (place: PlaceSeed): string[] => [...place.aliases, ...(place.queryOnly ?? [])];

export const PLACES: readonly PlaceSeed[] = [
  province('ha-noi', 'Hà Nội', { aliases: ['ha loi', 'thu do'], queryOnly: ['hn'], landmarks: ['ho guom', 'royal city'] }),
  province('hue', 'Huế', { aliases: ['thua thien hue', 'co do'], landmarks: ['song huong'] }),
  province('hai-phong', 'Hải Phòng', { queryOnly: ['hp'] }),
  province('da-nang', 'Đà Nẵng', { queryOnly: ['dn'], landmarks: ['my khe', 'cau rong'] }),
  province('ho-chi-minh', 'TP. Hồ Chí Minh', { aliases: ['ho chi minh', 'tp hcm', 'hcm'], exploreBucket: 'Sài Gòn' }),
  province('can-tho', 'Cần Thơ', { queryOnly: ['ct'] }),
  province('lai-chau', 'Lai Châu'),
  province('dien-bien', 'Điện Biên'),
  province('son-la', 'Sơn La'),
  province('lang-son', 'Lạng Sơn'),
  province('quang-ninh', 'Quảng Ninh'),
  province('thanh-hoa', 'Thanh Hóa'),
  province('nghe-an', 'Nghệ An', { landmarks: ['xu nghe'] }),
  province('ha-tinh', 'Hà Tĩnh'),
  province('cao-bang', 'Cao Bằng'),
  province('tuyen-quang', 'Tuyên Quang'),
  province('lao-cai', 'Lào Cai'),
  province('thai-nguyen', 'Thái Nguyên'),
  province('phu-tho', 'Phú Thọ'),
  province('bac-ninh', 'Bắc Ninh'),
  province('hung-yen', 'Hưng Yên'),
  province('ninh-binh', 'Ninh Bình', { aliases: ['trang an', 'tam coc'], landmarks: ['hang mua'] }),
  province('quang-tri', 'Quảng Trị'),
  province('quang-ngai', 'Quảng Ngãi'),
  province('gia-lai', 'Gia Lai'),
  province('khanh-hoa', 'Khánh Hòa'),
  province('lam-dong', 'Lâm Đồng'),
  province('dak-lak', 'Đắk Lắk', { aliases: ['dac lac'] }),
  province('dong-nai', 'Đồng Nai'),
  province('tay-ninh', 'Tây Ninh'),
  province('vinh-long', 'Vĩnh Long'),
  province('dong-thap', 'Đồng Tháp'),
  province('ca-mau', 'Cà Mau'),
  province('an-giang', 'An Giang'),
  destination('sai-gon', 'Sài Gòn', 'ho-chi-minh', { queryOnly: ['sg'], landmarks: ['landmark 81', 'dong khoi'] }),
  destination('con-dao', 'Côn Đảo', 'ho-chi-minh'),
  destination('vung-tau', 'Vũng Tàu', 'ho-chi-minh', { queryOnly: ['vt'] }),
  destination('hoi-an', 'Hội An', 'da-nang', { aliases: ['pho hoi'] }),
  destination('da-lat', 'Đà Lạt', 'lam-dong', { queryOnly: ['dl'] }),
  destination('nha-trang', 'Nha Trang', 'khanh-hoa', { queryOnly: ['nt'] }),
  destination('phu-quoc', 'Phú Quốc', 'an-giang', { queryOnly: ['pq'] }),
  destination('ha-long', 'Hạ Long', 'quang-ninh', { aliases: ['vinh ha long'] }),
  destination('quy-nhon', 'Quy Nhơn', 'gia-lai', { aliases: ['qui nhon'], queryOnly: ['qn'], landmarks: ['eo gio', 'ky co'] }),
  destination('ha-giang', 'Hà Giang', 'tuyen-quang'),
  destination('sa-pa', 'Sa Pa', 'lao-cai'),
  destination('co-to', 'Cô Tô', 'quang-ninh'),
  // Điểm đến bổ sung theo dữ liệu bài viết và bảng tỉnh sau sáp nhập 2025.
  destination('mui-ne', 'Mũi Né', 'lam-dong', { aliases: ['phan thiet'], landmarks: ['doi cat'] }),
  destination('cat-ba', 'Cát Bà', 'hai-phong', { landmarks: ['lan ha'] }),
  destination('moc-chau', 'Mộc Châu', 'son-la'),
  destination('mu-cang-chai', 'Mù Cang Chải', 'lao-cai'),
  destination('ba-na', 'Bà Nà', 'da-nang', { landmarks: ['ba na hills', 'cau vang'] }),
  destination('buon-ma-thuot', 'Buôn Ma Thuột', 'dak-lak', { landmarks: ['dray nur', 'dray'] }),
  destination('pleiku', 'Pleiku', 'gia-lai'),
  destination('bien-hoa', 'Biên Hòa', 'dong-nai'),
  // Không thêm 'vinh' đứng riêng: bỏ dấu trùng 'vịnh' ("vịnh Lan Hạ", "view vịnh") và làm placeFix sửa nhầm 'vin' → 'vinh'.
  destination('cua-lo', 'Cửa Lò', 'nghe-an', { aliases: ['tp vinh', 'thanh pho vinh'] }),
  destination('cam-ranh', 'Cam Ranh', 'khanh-hoa', { aliases: ['binh ba'] }),
  destination('phu-yen', 'Phú Yên', 'dak-lak', { aliases: ['tuy hoa'] }),
  destination('hon-son', 'Hòn Sơn', 'an-giang'),
  destination('kon-tum', 'Kon Tum', 'quang-ngai'),
];

const PLACE_ID_BY_NAME = new Map(
  PLACES.flatMap((p) =>
    [p.name, ...p.aliases, ...(p.queryOnly ?? []), ...(p.landmarks ?? [])].flatMap((raw) =>
      placeVariants(raw).map((v) => [v, p.id] as const),
    ),
  ),
);

/** Tên hoặc bí danh nơi (vd 'Đà Lạt' của lexicon tìm khám phá) → id trong PLACES; không có thì null. */
export const placeIdOfName = (name: string): string | null => PLACE_ID_BY_NAME.get(normalizeText(name)) ?? null;
