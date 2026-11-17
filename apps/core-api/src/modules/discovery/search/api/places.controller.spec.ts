import { BadRequestException } from '@nestjs/common';
import { findPointsOfInterest, type PointOfInterestSeed } from '../domain/points-of-interest.js';
import { PlacesController } from './places.controller.js';

const point = (id: string, kind: PointOfInterestSeed['kind'], lat: number, lng: number, popularity: number): PointOfInterestSeed => ({
  id,
  name: id,
  kind,
  lat,
  lng,
  cityId: 'vung-tau',
  tags: [],
  popularity,
});

// Toạ độ gần đúng quanh trung tâm Vũng Tàu (10.346, 107.0843).
const POINTS = [
  point('hai-dang', 'see', 10.3333, 107.0778, 0.9),
  point('bai-sau', 'see', 10.3487, 107.0938, 0.7),
  point('quan-an', 'food', 10.345, 107.072, 0.6),
  point('long-hai', 'see', 10.388, 107.237, 1),
  point('nha-nghi', 'lodging', 10.349, 107.095, 0.5),
];

describe('findPointsOfInterest', () => {
  it('lọc theo thành phố không dấu, loại và bán kính; xếp theo độ phổ biến', () => {
    const items = findPointsOfInterest({ city: 'vung tau', kinds: ['see'], radiusKm: 15, limit: 10 }, POINTS);
    expect(items.map((i) => i.id)).toEqual(['hai-dang', 'bai-sau']); // Long Hải xa hơn 15 km
    expect(items[0]).toMatchObject({ city: 'Vũng Tàu', kind: 'see' });
  });

  it('nhận toạ độ thay cho thành phố và cắt theo limit', () => {
    const items = findPointsOfInterest({ near: { lat: 10.3487, lng: 107.0938 }, radiusKm: 2, limit: 2 }, POINTS);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.id !== 'long-hai')).toBe(true);
  });

  it('nhận id và tên gọi khác của thành phố như trợ lý gửi', () => {
    const saigon = [{ ...point('cho-ben-thanh', 'see', 10.7725, 106.698, 0.9), cityId: 'ho-chi-minh' }];
    for (const city of ['TP.HCM', 'Sài Gòn', 'ho-chi-minh', 'TP. Hồ Chí Minh']) {
      expect(findPointsOfInterest({ city, radiusKm: 15, limit: 10 }, saigon).map((i) => i.id)).toEqual(['cho-ben-thanh']);
    }
    expect(findPointsOfInterest({ city: 'vung-tau', radiusKm: 15, limit: 10 }, POINTS)).toHaveLength(4);
  });

  it('thành phố chưa có dữ liệu thì rỗng, không đoán', () => {
    expect(findPointsOfInterest({ city: 'Hà Giang', radiusKm: 15, limit: 10 }, POINTS)).toEqual([]);
  });
});

describe('PlacesController', () => {
  const controller = new PlacesController();

  it('trả kèm dòng ghi nguồn OpenStreetMap', () => {
    expect(controller.places({ city: 'Vũng Tàu' }).attribution).toContain('OpenStreetMap');
  });

  it('thiếu cả city lẫn near, hoặc loại lạ, thì 400', () => {
    expect(() => controller.places({})).toThrow(BadRequestException);
    expect(() => controller.places({ city: 'Vũng Tàu', kinds: 'bar' })).toThrow(BadRequestException);
    expect(() => controller.places({ near: 'abc' })).toThrow(BadRequestException);
  });
});
