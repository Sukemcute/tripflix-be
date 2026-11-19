import { normalizeText } from './normalize-text.js';
import { LEX } from './explore/lexicon.js';
import { mostSpecificPlace, PLACES, placeIdOfName, placesIn, placeVariants } from './places.js';

describe('PLACES — một nguồn địa điểm duy nhất', () => {
  it('mỗi id duy nhất, đủ 34 tỉnh và mọi parentId đều là tỉnh tồn tại', () => {
    const byId = new Map(PLACES.map((p) => [p.id, p]));
    expect(byId.size).toBe(PLACES.length);
    const provinces = PLACES.filter((p) => p.kind === 'province');
    expect(provinces).toHaveLength(34);
    for (const province of provinces) expect(province.parentId).toBeNull();
    for (const place of PLACES.filter((p) => p.kind === 'destination')) {
      expect(place.parentId).toBeTruthy();
      const parent = byId.get(place.parentId!);
      expect(parent?.kind).toBe('province');
    }
  });

  it('không có bí danh nào trỏ về hai nơi khác nhau', () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const p of PLACES) {
      const raws = [p.name, ...p.aliases, ...(p.queryOnly ?? []), ...(p.landmarks ?? [])];
      for (const raw of raws) {
        for (const variant of placeVariants(raw)) {
          const prev = seen.get(variant);
          if (prev && prev !== p.id) collisions.push(`${variant}: ${prev} vs ${p.id}`);
          seen.set(variant, p.id);
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it('mọi bucket place trong LEX đều đổi ngược về id trong PLACES', () => {
    const ids = new Set(PLACES.map((p) => p.id));
    const buckets = new Set<string>();
    for (const hits of LEX.phrase.values()) {
      for (const [type, bucket] of hits) if (type === 'place') buckets.add(bucket);
    }
    for (const bucket of buckets) {
      const id = placeIdOfName(bucket);
      expect(id && ids.has(id)).toBe(true);
    }
  });

  it('mọi nơi tự tra ra chính nó từ tên, tên bỏ dấu và tên viết liền', () => {
    for (const p of PLACES) {
      const unaccented = normalizeText(p.name);
      const joined = unaccented.replace(/ /g, '');
      expect(placesIn(p.name)).toEqual([p.id]);
      expect(placesIn(unaccented)).toEqual([p.id]);
      expect(placesIn(joined)).toEqual([p.id]);
      expect(placeIdOfName(p.name)).toBe(p.id);
    }
  });

  it('placesIn: ưu tiên cụm dài nhất, theo ranh giới từ và thứ tự xuất hiện', () => {
    expect(placesIn('Hội An mùa thu')).toEqual(['hoi-an']);
    expect(placesIn('Từ Đà Nẵng qua Hội An rồi ra Huế')).toEqual(['da-nang', 'hoi-an', 'hue']);
    expect(placesIn('Chỗ ăn ngon ở Hội An')).toEqual(['hoi-an']);
    expect(placesIn('HaGiang #SaPa #muine #landmark81 #hoguom #caurong #royalcity #trangan #eogio')).toEqual([
      'ha-giang',
      'sa-pa',
      'mui-ne',
      'sai-gon',
      'ha-noi',
      'da-nang',
      'ninh-binh',
      'quy-nhon',
    ]);
    expect(placesIn('#royalcity')).toEqual(['ha-noi']);
  });

  it('viết tắt 2 chữ chỉ nhận khi isQuery=true, không đoán trong văn bản bài viết; không nhầm "vịnh"', () => {
    for (const abbr of ['hn', 'sg', 'dn', 'ct', 'vt', 'nt', 'dl', 'hp', 'pq', 'qn']) {
      expect(placesIn(abbr)).toEqual([]);
      expect(placesIn(abbr, { isQuery: true })).toHaveLength(1);
    }
    expect(placesIn('Công ty cổ phần CT và HN cuối tuần')).toEqual([]);
    expect(placesIn('du thuyền Vịnh Lan Hạ')).toEqual(['cat-ba']);
    expect(placesIn('view vịnh ở Phú Quốc')).toEqual(['phu-quoc']);
  });

  it.each([
    ['Cần Thơ chợ nổi Cái Răng', 'can-tho'],
    ['Biển Cát Bà trong xanh', 'cat-ba'],
    ['Mộc Châu mùa hoa mận trắng', 'moc-chau'],
    ['Phan Thiết Mũi Né: đồi cát bay, làng chài', 'mui-ne'],
    ['Buôn Ma Thuột: thác Dray Nur và cà phê', 'buon-ma-thuot'],
    ['Sun World Bà Nà Hills: cầu Vàng và làng Pháp', 'ba-na'],
    ['Pleiku Kon Tum: biển Hồ và nhà rông', 'pleiku'],
    ['Vĩnh Long: miệt vườn, chợ nổi Cái Bè', 'vinh-long'],
    ['Vinh 2N1Đ: bãi biển Cửa Lò và ẩm thực xứ Nghệ', 'cua-lo'],
    ['Mua sắm ở Vincom Plaza Biên Hòa và ăn hải sản', 'bien-hoa'],
    ['Mùa lúa chín Mù Cang Chải', 'mu-cang-chai'],
    ['Vincom Mega Mall Royal City: trượt băng và rạp chiếu phim', 'ha-noi'],
    ['Bình Ba Cam Ranh: tôm hùm và lặn ngắm san hô', 'cam-ranh'],
    ['Cầu Rồng phun lửa cuối tuần', 'da-nang'],
  ])('tiêu đề "%s" → %s', (title, expected) => {
    expect(mostSpecificPlace(placesIn(title))).toBe(expected);
  });

  it.each([
    'Lướt ảnh cũ mà muốn xách balo lên đi liền',
    'Hôm nay hơi mệt, cần một chuyến đi quá',
    'Ai có kinh nghiệm xin visa không chỉ mình với',
    'Nhớ biển ghê, ai đi cùng không',
    'Một ngày bình thường thôi',
    'Cuối tuần ở nhà nấu ăn cũng vui',
  ])('tiêu đề không nói nơi "%s" → []', (title) => {
    expect(placesIn(title)).toEqual([]);
  });
});
