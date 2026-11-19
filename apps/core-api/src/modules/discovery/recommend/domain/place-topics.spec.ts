import { placeStyleProfiles } from './place-topics.js';

describe('placeStyleProfiles', () => {
  // Số liệu kiểu khách sạn trên DB local 19/11 (rút gọn).
  const counts = [
    { placeId: 'da-lat', style: 'núi', hotels: 60 }, { placeId: 'da-lat', style: 'homestay', hotels: 11 }, { placeId: 'da-lat', style: 'resort', hotels: 3 },
    { placeId: 'quy-nhon', style: 'biển', hotels: 16 }, { placeId: 'quy-nhon', style: 'thành phố', hotels: 7 },
    { placeId: 'phu-quoc', style: 'resort', hotels: 30 }, { placeId: 'phu-quoc', style: 'biển', hotels: 17 }, { placeId: 'phu-quoc', style: 'thành phố', hotels: 17 },
    { placeId: 'ha-noi', style: 'thành phố', hotels: 119 }, { placeId: 'ha-noi', style: 'boutique', hotels: 12 },
    { placeId: 'hon-son', style: 'biển', hotels: 2 },
  ];
  const profiles = placeStyleProfiles(counts);

  it('nơi thiên về kiểu nào thì ra ngăn đó: Đà Lạt núi, Quy Nhơn biển, Phú Quốc biển và nghỉ dưỡng', () => {
    expect(Object.keys(profiles.get('place:da-lat')!)).toEqual(['exp:nui']);
    expect(Object.keys(profiles.get('place:quy-nhon')!)).toEqual(['exp:bien']);
    expect(Object.keys(profiles.get('place:phu-quoc')!).sort()).toEqual(['exp:bien', 'exp:nghi_duong']);
  });

  it('nơi toàn khách sạn "thành phố" thì không có ngăn; nơi quá ít khách sạn thì chưa đủ để nói', () => {
    expect(profiles.has('place:ha-noi')).toBe(false);
    expect(profiles.has('place:hon-son')).toBe(false);
  });
});
