import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Dữ liệu seed phải khớp cây địa điểm của discovery và không có giá trị giả thay cho "không có".
const catalog = JSON.parse(readFileSync(fileURLToPath(new URL('./catalog.json', import.meta.url)), 'utf8')) as {
  hotels: { name: string; brand: string | null; provinceSlug: string }[];
  flights: { destinationSlug: string }[];
};

describe('catalog.json (seed commerce)', () => {
  it('khách sạn độc lập để brand = null, không ghi chữ "Độc lập"', () => {
    expect(catalog.hotels.filter((h) => h.brand === 'Độc lập')).toEqual([]);
  });

  it('khách sạn tên bắt đầu bằng Vinpearl có brand Vinpearl', () => {
    expect(catalog.hotels.filter((h) => /^vinpearl\b/i.test(h.name) && h.brand !== 'Vinpearl').map((h) => h.name)).toEqual([]);
  });

  it('nơi đến chuyến bay là slug tỉnh / điểm đến, không phải mã sân bay', () => {
    expect(catalog.flights.filter((f) => /^[a-z]{3}$/.test(f.destinationSlug) && !['hue'].includes(f.destinationSlug)).map((f) => f.destinationSlug)).toEqual([]);
  });
});
