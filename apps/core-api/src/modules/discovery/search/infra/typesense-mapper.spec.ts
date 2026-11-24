import { indexDoc } from '../domain/explore/build.js';
import type { ExploreObject } from '../domain/explore/types.js';
import { indexedDocToTypesenseDoc, typesenseDocToIndexedDoc } from './typesense-mapper.js';
import { buildExploreCollectionSchema, buildExploreSynonyms } from './typesense-schema.js';

describe('typesense-schema & typesense-mapper', () => {
  it('schema không chứa embedding ở Phase 1–4 và có đủ cặp *_vi + *_folded', () => {
    const schema = buildExploreCollectionSchema('explore_1');
    const names = schema.fields.map((f) => f.name);
    expect(names).not.toContain('embedding');
    expect(names).toEqual(expect.arrayContaining(['title_vi', 'title_folded', 'body_vi', 'body_folded', 'place_buckets', 'doc_json']));
    expect(schema.default_sorting_field).toBe('quality_score');
  });

  it('buildExploreSynonyms sinh one-way cho norm (>= 2 ký tự) và multi-way cho concept/mod', () => {
    const syns = buildExploreSynonyms();
    const cafeNorm = syns.find((s) => s.payload.root === 'cafe');
    expect(cafeNorm).toBeDefined();
    expect(cafeNorm!.payload.synonyms).toEqual(expect.arrayContaining(['cf', 'coffee', 'ca phe']));
    // Bỏ từ 1 ký tự như 'k', 'j', 'r' để không gây nhiễu
    expect(syns.every((s) => s.payload.synonyms.every((t) => t.length >= 2))).toBe(true);
    const sunset = syns.find((s) => !s.payload.root && s.payload.synonyms.includes('hoang hon'));
    expect(sunset?.payload.synonyms).toEqual(expect.arrayContaining(['hoang hon', 'sunset', 'san may']));
  });

  it('place_buckets tuân thủ CITY_PROVINCES: Đà Lạt gồm Lâm Đồng; Hội An KHÔNG gồm Đà Nẵng', () => {
    const daLatHotel = indexDoc(
      { id: 'hotel:1', kind: 'stay', title: 'Khách sạn Đà Lạt', place: 'Đà Lạt', priceNight: 900_000, stars: 4 },
      'stays',
      0,
    );
    const hoiAnHotel = indexDoc(
      { id: 'hotel:2', kind: 'stay', title: 'Resort Hội An', place: 'Hội An', lat: 15.88, lon: 108.33, priceNight: 2_500_000, stars: 5 },
      'stays',
      1,
    );
    expect(indexedDocToTypesenseDoc(daLatHotel).place_buckets).toEqual(['Đà Lạt', 'Lâm Đồng']);
    expect(indexedDocToTypesenseDoc(hoiAnHotel).place_buckets).toEqual(['Hội An']);
    expect(indexedDocToTypesenseDoc(hoiAnHotel).location).toEqual([15.88, 108.33]);
  });

  it('typesenseDocToIndexedDoc overlay likes/comments mới và bỏ qua hotel không có likes', () => {
    const postObj: ExploreObject = {
      id: 'post:P1',
      refId: 'P1',
      kind: 'post',
      title: 'Kinh nghiệm Phú Quốc #phuquoc #hoanghon',
      text: 'Ngắm hoàng hôn rất đẹp #phuquoc',
      place: 'Phú Quốc',
      likes: 10,
      n: 2,
      createdAt: '2026-11-01T00:00:00.000Z',
      completeness: 0.8,
    };
    const tsDoc = indexedDocToTypesenseDoc(indexDoc(postObj, 'plans', 0), 0.91);
    expect(tsDoc.tags_folded).toContain('phuquoc');
    expect(tsDoc.place_buckets).toEqual(['Phú Quốc', 'An Giang']);
    expect(tsDoc.hot_score).toBe(0.91);

    tsDoc.likes = 250;
    tsDoc.comments = 44;
    const restored = typesenseDocToIndexedDoc(tsDoc);
    expect(restored.doc.obj.likes).toBe(250);
    expect(restored.doc.obj.n).toBe(44);
    expect(restored.hotScore).toBe(0.91);
  });
});
