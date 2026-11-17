import { describe, expect, it } from 'vitest';
import { addDays, airportsForPlace, pickOrigin, placesServedBy, planTripAddons, provinceGroupOf, provinceOf } from './trip-addons.js';

const hotel = (hotelId: string, checkIn: string, checkOut: string) => ({ type: 'hotel' as const, hotelId, checkIn, checkOut });
const flight = (fromAirport: string, toAirport: string, date: string) => ({ type: 'flight' as const, fromAirport, toAirport, date });

describe('planTripAddons', () => {
  it('có phòng, chưa có vé: gợi ý vé, đi ngày nhận phòng sớm nhất, về ngày trả phòng muộn nhất', () => {
    expect(planTripAddons([hotel('H2', '2026-12-03', '2026-12-05'), hotel('H1', '2026-12-01', '2026-12-03')])).toEqual({
      missing: 'flight',
      hotelId: 'H1',
      returnHotelId: 'H2',
      departDate: '2026-12-01',
      returnDate: '2026-12-05',
    });
  });

  it('có vé khứ hồi, chưa có phòng: ở nơi đến từ ngày đi tới ngày về', () => {
    expect(planTripAddons([flight('CXR', 'SGN', '2026-12-04'), flight('SGN', 'CXR', '2026-12-01')])).toEqual({
      missing: 'hotel',
      toAirport: 'CXR',
      checkIn: '2026-12-01',
      checkOut: '2026-12-04',
    });
  });

  it('vé một chiều: ở mặc định 2 đêm', () => {
    expect(planTripAddons([flight('SGN', 'CXR', '2026-12-30')])).toMatchObject({ missing: 'hotel', checkIn: '2026-12-30', checkOut: '2027-01-01' });
  });

  it('đủ cả phòng và vé, hoặc chưa chọn gì: không gợi ý', () => {
    expect(planTripAddons([hotel('H1', '2026-12-01', '2026-12-03'), flight('SGN', 'CXR', '2026-12-01')])).toEqual({ missing: null });
    expect(planTripAddons([])).toEqual({ missing: null });
  });
});

describe('provinceOf, provinceGroupOf', () => {
  it('điểm đến lấy tỉnh cha, tỉnh gồm cả điểm đến con', () => {
    expect(provinceOf('nha-trang')).toBe('khanh-hoa');
    expect(provinceGroupOf('nha-trang')).toEqual(expect.arrayContaining(['khanh-hoa', 'nha-trang']));
    expect(provinceGroupOf('khanh-hoa')).toEqual(provinceGroupOf('nha-trang'));
  });

  it('nơi lạ chỉ có chính nó', () => {
    expect(provinceGroupOf('moi-them')).toEqual(['moi-them']);
  });
});

describe('pickOrigin', () => {
  it('giữ sân bay người dùng chọn nếu có chuyến, không thì SGN, rồi HAN, rồi theo ABC', () => {
    expect(pickOrigin(['HAN', 'SGN', 'DAD'], 'DAD')).toBe('DAD');
    expect(pickOrigin(['HAN', 'SGN'], 'PQC')).toBe('SGN');
    expect(pickOrigin(['HAN', 'DAD'])).toBe('HAN');
    expect(pickOrigin(['VII', 'DAD'])).toBe('DAD');
    expect(pickOrigin([])).toBeNull();
  });
});

describe('airportsForPlace, placesServedBy', () => {
  // Rút từ dữ liệu commerce local (17/11).
  const FLIGHTS = [
    { toAirport: 'SGN', placeSlug: 'sai-gon' },
    { toAirport: 'SGN', placeSlug: 'dong-nai' },
    { toAirport: 'VCS', placeSlug: 'con-dao' },
    { toAirport: 'CXR', placeSlug: 'nha-trang' },
    { toAirport: 'CXR', placeSlug: 'khanh-hoa' },
    { toAirport: 'DAD', placeSlug: 'da-nang' },
    { toAirport: 'DAD', placeSlug: 'hoi-an' },
  ];

  it('đúng nơi trước: Côn Đảo → VCS, Sài Gòn → SGN, Nha Trang → CXR', () => {
    expect(airportsForPlace('con-dao', FLIGHTS)).toEqual(['VCS']);
    expect(airportsForPlace('sai-gon', FLIGHTS)).toEqual(['SGN']);
    expect(airportsForPlace('nha-trang', FLIGHTS)).toEqual(['CXR']);
  });

  it('nơi không có chuyến riêng: lấy nơi cùng tỉnh nhưng bỏ điểm đến có sân bay riêng (Vũng Tàu → SGN, không VCS)', () => {
    expect(airportsForPlace('vung-tau', FLIGHTS)).toEqual(['SGN']);
  });

  it('nơi không có sân bay trong dữ liệu: rỗng', () => {
    expect(airportsForPlace('lao-cai', FLIGHTS)).toEqual([]);
  });

  it('sân bay phục vụ những nơi nào', () => {
    expect(placesServedBy('VCS', FLIGHTS)).toEqual(['con-dao']);
    expect(placesServedBy('CXR', FLIGHTS)).toEqual(['khanh-hoa', 'nha-trang']);
  });
});

describe('addDays', () => {
  it('qua tháng, qua năm', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 2)).toBe('2027-01-02');
  });
});
