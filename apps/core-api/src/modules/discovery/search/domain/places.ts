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
  /** Tên gọi khác, gõ tắt; sẽ được chuẩn hoá trước khi so khớp. */
  aliases: string[];
}

const province = (id: string, name: string, aliases: string[] = []): PlaceSeed => ({
  id,
  name,
  kind: 'province',
  parentId: null,
  aliases,
});

const destination = (id: string, name: string, parentId: string, aliases: string[] = []): PlaceSeed => ({
  id,
  name,
  kind: 'destination',
  parentId,
  aliases,
});

export const PLACES: readonly PlaceSeed[] = [
  province('ha-noi', 'Hà Nội', ['hn', 'hanoi']),
  province('hue', 'Huế', ['thua thien hue']),
  province('hai-phong', 'Hải Phòng', ['hp']),
  province('da-nang', 'Đà Nẵng', ['dn', 'danang']),
  province('ho-chi-minh', 'TP. Hồ Chí Minh', ['hcm', 'tphcm', 'tp hcm', 'ho chi minh']),
  province('can-tho', 'Cần Thơ', ['ct']),
  province('lai-chau', 'Lai Châu'),
  province('dien-bien', 'Điện Biên'),
  province('son-la', 'Sơn La'),
  province('lang-son', 'Lạng Sơn'),
  province('quang-ninh', 'Quảng Ninh'),
  province('thanh-hoa', 'Thanh Hóa', ['thanh hoa']),
  province('nghe-an', 'Nghệ An'),
  province('ha-tinh', 'Hà Tĩnh'),
  province('cao-bang', 'Cao Bằng'),
  province('tuyen-quang', 'Tuyên Quang'),
  province('lao-cai', 'Lào Cai'),
  province('thai-nguyen', 'Thái Nguyên'),
  province('phu-tho', 'Phú Thọ'),
  province('bac-ninh', 'Bắc Ninh'),
  province('hung-yen', 'Hưng Yên'),
  province('ninh-binh', 'Ninh Bình'),
  province('quang-tri', 'Quảng Trị'),
  province('quang-ngai', 'Quảng Ngãi'),
  province('gia-lai', 'Gia Lai'),
  province('khanh-hoa', 'Khánh Hòa'),
  province('lam-dong', 'Lâm Đồng'),
  province('dak-lak', 'Đắk Lắk', ['daklak', 'dac lac']),
  province('dong-nai', 'Đồng Nai'),
  province('tay-ninh', 'Tây Ninh'),
  province('vinh-long', 'Vĩnh Long'),
  province('dong-thap', 'Đồng Tháp'),
  province('ca-mau', 'Cà Mau'),
  province('an-giang', 'An Giang'),
  destination('sai-gon', 'Sài Gòn', 'ho-chi-minh', ['sg', 'saigon']),
  destination('con-dao', 'Côn Đảo', 'ho-chi-minh'),
  destination('hoi-an', 'Hội An', 'da-nang', ['hoian']),
  destination('da-lat', 'Đà Lạt', 'lam-dong', ['dl', 'dalat']),
  destination('nha-trang', 'Nha Trang', 'khanh-hoa', ['nt', 'nhatrang']),
  destination('phu-quoc', 'Phú Quốc', 'an-giang', ['pq', 'phuquoc']),
  destination('ha-long', 'Hạ Long', 'quang-ninh', ['halong']),
  destination('quy-nhon', 'Quy Nhơn', 'gia-lai', ['quynhon']),
];

const PLACE_ID_BY_NAME = new Map(PLACES.flatMap((p) => [p.name, ...p.aliases].map((n) => [normalizeText(n), p.id] as const)));

/** Tên hoặc bí danh nơi (vd 'Đà Lạt' của lexicon tìm khám phá) → id trong PLACES; không có thì null. */
export const placeIdOfName = (name: string): string | null => PLACE_ID_BY_NAME.get(normalizeText(name)) ?? null;
