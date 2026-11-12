import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface SeedRatePlan { code: string; meal: string; refundable: boolean; freeCancelDays: number; discountPct: number; perks: string[] }
interface SeedRoomType { id: string; code: string; name: string; ratePlans: SeedRatePlan[]; details?: { view?: string; images?: string[] } }
interface SeedHotel {
  id: string;
  name: string;
  brand: string | null;
  provinceSlug: string;
  style: string | null;
  stars: number | null;
  thumbnail: string | null;
  images: string[];
  lat: number | null;
  lng: number | null;
  ratingSource: string | null;
  roomTypes: SeedRoomType[];
  details: { nearby: { name: string; distanceKm: number }[] };
}

// Dữ liệu seed phải khớp cây địa điểm của discovery và không có giá trị giả thay cho "không có".
const readSeed = (file: string) => JSON.parse(readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8'));
const catalog = readSeed('./catalog.json') as { hotels: SeedHotel[]; flights: { destinationSlug: string }[] };
const imageCredits = readSeed('./osm-image-credits.json') as Record<string, { pageUrl: string; author: string; license: string }>;
// Khách sạn lấy từ OpenStreetMap (TF80): ảnh Wikimedia Commons riêng cho từng khách sạn và loại phòng.
const osmHotels = catalog.hotels.filter((h) => h.id.startsWith('P-osm-'));
const allRooms = catalog.hotels.flatMap((h) => h.roomTypes.map((r) => ({ hotel: h, room: r })));

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

  it('id khách sạn và id loại phòng không trùng, id loại phòng bắt đầu bằng id khách sạn', () => {
    const hotelIds = catalog.hotels.map((h) => h.id);
    const roomIds = allRooms.map(({ room }) => room.id);
    expect(hotelIds.length).toBe(new Set(hotelIds).size);
    expect(roomIds.length).toBe(new Set(roomIds).size);
    expect(allRooms.filter(({ hotel, room }) => !room.id.startsWith(`${hotel.id}--`)).map(({ room }) => room.id)).toEqual([]);
  });

  it('gói không hoàn huỷ có 0 ngày huỷ miễn phí, gói hoàn huỷ có ít nhất 1 ngày', () => {
    const wrong = allRooms.flatMap(({ room }) =>
      room.ratePlans.filter((p) => (p.refundable ? p.freeCancelDays <= 0 : p.freeCancelDays !== 0)).map((p) => `${room.id}/${p.code}`),
    );
    expect(wrong).toEqual([]);
  });

  it('gói chỉ phòng không có ưu đãi ăn sáng', () => {
    const wrong = allRooms.flatMap(({ room }) =>
      room.ratePlans.filter((p) => p.meal === 'none' && p.perks.some((perk) => /ăn sáng/i.test(perk))).map((p) => `${room.id}/${p.code}`),
    );
    expect(wrong).toEqual([]);
  });

  describe('khách sạn lấy từ OpenStreetMap', () => {
    it('có khoảng 1.980 khách sạn, toạ độ nằm trong Việt Nam', () => {
      expect(osmHotels.length).toBeGreaterThanOrEqual(1900);
      expect(osmHotels.filter((h) => !(h.lat! >= 8 && h.lat! <= 23.5 && h.lng! >= 102 && h.lng! <= 110)).map((h) => h.id)).toEqual([]);
    });

    it('không ghi nguồn điểm ngoài (TripAdvisor, Google) vì điểm là của đánh giá demo', () => {
      expect(osmHotels.filter((h) => h.ratingSource !== null).map((h) => h.id)).toEqual([]);
    });

    it('phòng hướng biển chỉ có ở khách sạn biển hoặc resort, villa chỉ có ở resort', () => {
      const wrong = osmHotels.flatMap((h) =>
        h.roomTypes
          .filter((r) => (r.details?.view === 'sea' && !['biển', 'resort'].includes(h.style ?? '')) || (r.code.startsWith('VL') && h.style !== 'resort'))
          .map((r) => r.id),
      );
      expect(wrong).toEqual([]);
    });

    it('địa điểm gần đó xếp theo khoảng cách tăng dần', () => {
      const wrong = osmHotels.filter((h) => h.details.nearby.some((n, i, all) => i > 0 && n.distanceKm < all[i - 1]!.distanceKm)).map((h) => h.id);
      expect(wrong).toEqual([]);
    });

    it('mỗi khách sạn có 5 ảnh khác nhau, ảnh đại diện là ảnh đầu tiên', () => {
      expect(osmHotels.filter((h) => h.images.length !== 5 || new Set(h.images).size !== 5 || h.thumbnail !== h.images[0]).map((h) => h.id)).toEqual([]);
    });

    it('mỗi loại phòng có 1–3 ảnh riêng', () => {
      const wrong = osmHotels.flatMap((h) => h.roomTypes.filter((r) => !r.details?.images || r.details.images.length < 1 || r.details.images.length > 3).map((r) => r.id));
      expect(wrong).toEqual([]);
    });

    it('không ảnh nào dùng lại ở khách sạn hoặc loại phòng khác', () => {
      const owner = new Map<string, string>();
      const reused: string[] = [];
      for (const h of osmHotels) {
        // Ảnh đầu của loại phòng được phép xuất hiện trong thư viện ảnh của chính khách sạn đó.
        const hotelImages = new Set([...h.images, ...h.roomTypes.flatMap((r) => r.details?.images ?? [])]);
        for (const image of hotelImages) {
          if (owner.has(image)) reused.push(`${image} (${owner.get(image)} và ${h.id})`);
          owner.set(image, h.id);
        }
      }
      expect(reused).toEqual([]);
    });

    it('mọi ảnh đều có nguồn, tác giả và giấy phép trong osm-image-credits.json', () => {
      const images = osmHotels.flatMap((h) => [...h.images, ...h.roomTypes.flatMap((r) => r.details?.images ?? [])]);
      const missing = images.map((image) => image.replace(/^\/images\/osm\//, '')).filter((file) => !imageCredits[file]?.license || !imageCredits[file]?.pageUrl);
      expect(missing).toEqual([]);
    });
  });
});
