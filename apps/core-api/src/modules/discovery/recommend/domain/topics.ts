/**
 * Bộ ngăn của gợi ý v1 (TF28): năm câu hỏi của một chuyến đi.
 * place: đi đâu · exp: đến đó làm gì · cost: tốn bao nhiêu · with/len: đi với ai, mấy ngày · season: đi lúc nào.
 * Mã ngăn dạng '<câu hỏi>:<mã>'. Chỉ map tag rõ nghĩa; tag mơ hồ để là hashtag thường, không vào ngăn nào.
 * Đổi mã ngăn (thêm/bỏ/đổi tên) thì tăng version builder dùng nó; thêm tag hay từ khoá vào ngăn có sẵn thì không cần.
 */

export const EXP = ['an_uong', 'song_ao', 'nui', 'cafe', 'bien', 'van_hoa', 've_dem', 'nghi_duong', 'vui_choi'] as const;
export type Exp = (typeof EXP)[number];

/** Tên hiện trong lý do: "Vì bạn hay xem bài về ___". */
export const EXP_LABEL: Record<Exp, string> = {
  an_uong: 'ăn uống',
  song_ao: 'ngắm cảnh, sống ảo',
  nui: 'núi, thiên nhiên',
  cafe: 'cà phê',
  bien: 'biển đảo',
  van_hoa: 'văn hoá, di tích',
  ve_dem: 'về đêm',
  nghi_duong: 'nghỉ dưỡng',
  vui_choi: 'khu vui chơi, mua sắm',
};

/**
 * Câu mô tả ngăn để so cosine với vector caption (TF28, thí nghiệm caption thật 19/11): giữ nguyên chữ đã đo.
 * Đổi chữ thì đo lại biên CAPTION_MARGIN (bins.ts).
 */
export const EXP_DESCRIPTIONS: Record<Exp, string> = {
  an_uong: 'Bài du lịch về ăn uống: món ăn địa phương, đồ ăn đường phố, quán ngon, hải sản, ăn vặt, food tour.',
  song_ao: 'Bài du lịch về ngắm cảnh và chụp ảnh sống ảo: góc check-in đẹp, view đẹp, hoàng hôn, bình minh.',
  nui: 'Bài du lịch về núi và thiên nhiên: săn mây, trekking, leo núi, thác nước, ruộng bậc thang, cắm trại.',
  cafe: 'Bài du lịch về quán cà phê: cà phê view đẹp, quán chill, ngồi uống cà phê, làm việc ở quán.',
  bien: 'Bài du lịch về biển đảo: tắm biển, bãi cát, lặn ngắm san hô, đi cano ra đảo, nghỉ ở bãi biển.',
  van_hoa: 'Bài du lịch về văn hoá và di tích: phố cổ, chùa, đền, bảo tàng, lịch sử, làng nghề, chợ nổi.',
  ve_dem: 'Bài du lịch về cuộc sống về đêm: phố đêm, chợ đêm, quán bar, phố đi bộ, nightlife.',
  nghi_duong: 'Bài du lịch về nghỉ dưỡng: resort, khách sạn cao cấp, hồ bơi, spa, thư giãn, nghỉ ngơi.',
  vui_choi: 'Bài du lịch về khu vui chơi và mua sắm: công viên giải trí, VinWonders, Sun World, trò chơi, trung tâm thương mại.',
};
/** Mô hình nhúng mà biên CAPTION_MARGIN được đo trên (ai-service POST /embed). Vector của mô hình khác không dùng. */
export const CAPTION_MODEL = 'multilingual-e5-small@614241f622f5';

/** Hashtag (chữ thường, bỏ dấu, bỏ khoảng trắng) → ngăn. Chỉ `resort` vào hai ngăn. */
export const TAG_BINS: Readonly<Record<string, readonly string[]>> = {
  // exp
  anuong: ['exp:an_uong'], streetfood: ['exp:an_uong'], anvat: ['exp:an_uong'], foodtour: ['exp:an_uong'], caolau: ['exp:an_uong'],
  banhkhot: ['exp:an_uong'], bunbo: ['exp:an_uong'], miquang: ['exp:an_uong'], tomhum: ['exp:an_uong'], haisan: ['exp:an_uong'],
  songao: ['exp:song_ao'], checkin: ['exp:song_ao'],
  nui: ['exp:nui'], sanmay: ['exp:nui'], fansipan: ['exp:nui'], captreo: ['exp:nui'], camping: ['exp:nui'], luachin: ['exp:nui'],
  cafe: ['exp:cafe'], caphe: ['exp:cafe'],
  bien: ['exp:bien'], bienvietnam: ['exp:bien'], dulichbien: ['exp:bien'], lanbien: ['exp:bien'], daongoc: ['exp:bien'],
  vanhoa: ['exp:van_hoa'], phoco: ['exp:van_hoa'], tamlinh: ['exp:van_hoa'], chonoi: ['exp:van_hoa'], mietvuon: ['exp:van_hoa'],
  nightlife: ['exp:ve_dem'], buivien: ['exp:ve_dem'], chodem: ['exp:ve_dem'],
  resort: ['exp:nghi_duong', 'cost:cao_cap'], relax: ['exp:nghi_duong'],
  vinwonders: ['exp:vui_choi'], sunworld: ['exp:vui_choi'], oceanpark: ['exp:vui_choi'], grandworld: ['exp:vui_choi'], bana: ['exp:vui_choi'],
  giaitri: ['exp:vui_choi'], tauluon: ['exp:vui_choi'], shopping: ['exp:vui_choi'], muasam: ['exp:vui_choi'], vincom: ['exp:vui_choi'],
  lotte: ['exp:vui_choi'], benthanh: ['exp:vui_choi'],
  // cost
  tietkiem: ['cost:binh_dan'], homestay: ['cost:binh_dan'], phuot: ['cost:binh_dan'], xemay: ['cost:binh_dan'], locotrip: ['cost:binh_dan'],
  sangchanh: ['cost:cao_cap'], vinpearl: ['cost:cao_cap'], emeralda: ['cost:cao_cap'], hoteldelacoupole: ['cost:cao_cap'], dalatpalace: ['cost:cao_cap'],
  // with, len
  giadinh: ['with:gia_dinh'], capdoi: ['with:cap_doi'], dulichmotminh: ['with:mot_minh'],
  weekend: ['len:ngan'],
};

/** Tag nơi, địa danh → id trong PLACES (search/domain/places.ts). Dùng khi bài chưa có nơi từ khách sạn hay tiêu đề. */
export const TAG_PLACES: Readonly<Record<string, string>> = {
  saigon: 'sai-gon', landmark81: 'sai-gon', dongkhoi: 'sai-gon',
  hanoi: 'ha-noi', hoguom: 'ha-noi', royalcity: 'ha-noi',
  danang: 'da-nang', mykhe: 'da-nang', caurong: 'da-nang',
  hoian: 'hoi-an', hue: 'hue', songhuong: 'hue',
  nhatrang: 'nha-trang', binhba: 'khanh-hoa', camranh: 'khanh-hoa',
  dalat: 'da-lat', lamdong: 'lam-dong', phanthiet: 'lam-dong', muine: 'lam-dong', doicat: 'lam-dong',
  phuquoc: 'phu-quoc', condao: 'con-dao', vungtau: 'vung-tau', quynhon: 'quy-nhon',
  eogio: 'gia-lai', kyco: 'gia-lai', pleiku: 'gia-lai',
  halong: 'ha-long', vinhhalong: 'ha-long', coto: 'quang-ninh', catba: 'hai-phong', lanha: 'hai-phong',
  ninhbinh: 'ninh-binh', trangan: 'ninh-binh', hangmua: 'ninh-binh',
  sapa: 'lao-cai', laocai: 'lao-cai', mucangchai: 'lao-cai', hagiang: 'tuyen-quang', mocchau: 'son-la',
  vinh: 'nghe-an', cualo: 'nghe-an', nghean: 'nghe-an', bienhoa: 'dong-nai',
  buonmathuot: 'dak-lak', dray: 'dak-lak', kontum: 'quang-ngai', cantho: 'can-tho', vinhlong: 'vinh-long',
};

/**
 * Cụm từ (đã chuẩn hoá bằng normalizeText) trong tiêu đề / nội dung → ngăn. So theo ranh giới từ.
 * Tránh từ một âm tiết dễ trùng tên riêng ("dao" trong "Sapa Dao Homestay", "bien" trong "Biên Hoà").
 */
export const PHRASE_BINS: Readonly<Record<string, readonly string[]>> = {
  'exp:an_uong': ['an uong', 'an vat', 'quan an', 'am thuc', 'street food', 'food tour', 'hai san', 'mon ngon', 'an sang', 'an toi', 'an no'],
  'exp:song_ao': ['song ao', 'check in', 'hoang hon', 'chup anh', 'goc chup', 'view dep'],
  'exp:nui': ['san may', 'trekking', 'leo nui', 'thac', 'ruong bac thang', 'cam trai', 'con deo', 'nui'],
  'exp:cafe': ['ca phe', 'cafe', 'coffee'],
  'exp:bien': ['bai bien', 'tam bien', 'lan bien', 'hon dao', 'ra dao', 'dao ngoc', 'bien xanh', 'ngam bien'],
  // Không dùng "chua" (chùa / chưa) hay "deo" (đèo / đeo): bỏ dấu rồi thì trùng chữ thường.
  'exp:van_hoa': ['pho co', 'ngoi chua', 'vieng chua', 'bao tang', 'di tich', 'van hoa', 'lang nghe', 'cho noi', 'nha tho', 'dinh lang', 'nha rong'],
  'exp:ve_dem': ['ve dem', 'cho dem', 'pho di bo', 'nightlife', 'quan bar', 'pub'],
  'exp:nghi_duong': ['resort', 'nghi duong', 'thu gian'],
  'exp:vui_choi': ['vinwonders', 'sun world', 'khu vui choi', 'cong vien nuoc', 'trung tam thuong mai', 'mua sam', 'truot bang', 'ba na hills'],
  'cost:binh_dan': ['homestay', 'hostel', 'tiet kiem', 'gia re', 'binh dan', 'sinh vien'],
  'cost:cao_cap': ['resort', 'sang chanh', '5 sao', 'cao cap', 'vinpearl'],
  'with:gia_dinh': ['gia dinh', 'bo me', 'con nho'],
  'with:cap_doi': ['cap doi', 'nguoi yeu', 'hen ho', 'honeymoon', 'trang mat'],
  'with:mot_minh': ['mot minh', 'solo'],
  'with:nhom_ban': ['hoi ban', 'nhom ban', 'hoi chi em', 'ca team'],
  'len:ngan': ['cuoi tuan', 'weekend', '2 ngay 1 dem', '2n1d'],
  'season:xuan': ['mua xuan', 'thang 2', 'thang 3'],
  'season:he': ['mua he', 'thang 6', 'thang 7', 'thang 8'],
  'season:thu': ['mua thu', 'thang 9', 'thang 10', 'thang 11'],
  'season:dong': ['mua dong', 'thang 12', 'thang 1'],
  'season:tet': ['tet'],
};

/** Loại điểm lịch trình (TF105) → ngăn. */
export const ITEM_CATEGORY_BINS: Readonly<Record<string, string>> = { food: 'exp:an_uong', cafe: 'exp:cafe', fun: 'exp:vui_choi' };

/**
 * Ngưỡng tầm giá (chốt 18/11, phân vị 33/67 trên DB local, làm tròn). VND.
 * ponytail: ngưỡng cứng theo giá mô phỏng; giá thật khác thì đo lại phân vị và sửa ở đây.
 */
export const COST_PER_PERSON = { budgetBelow: 2_000_000, premiumAbove: 3_500_000 };
export const PRICE_PER_NIGHT = { budgetBelow: 600_000, premiumAbove: 1_200_000 };

export function costBin(value: number, t: { budgetBelow: number; premiumAbove: number }): string {
  if (value < t.budgetBelow) return 'cost:binh_dan';
  return value > t.premiumAbove ? 'cost:cao_cap' : 'cost:trung';
}

/** Số ngày chuyến → ngăn độ dài. */
export const lenBin = (days: number): string => (days <= 2 ? 'len:ngan' : days <= 4 ? 'len:vua' : 'len:dai');
