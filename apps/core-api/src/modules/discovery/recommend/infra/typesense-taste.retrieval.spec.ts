import type { TypesenseClient } from '../../search/infra/typesense.client.js';
import { TypesenseTasteRetrieval } from './typesense-taste.retrieval.js';

describe('TypesenseTasteRetrieval', () => {
  it('một multi_search: nơi (đổi mã sang tên nơi) và tag (bỏ tag trào lưu); chỉ trả id bài, không trùng', async () => {
    const multiSearch = vi.fn(async () => [
      { hits: [{ document: { id: 'post:A' } }, { document: { id: 'post:B' } }] },
      { hits: [{ document: { id: 'post:B' } }, { document: { id: 'hotel:H' } }] },
    ]);
    const retrieval = new TypesenseTasteRetrieval({ multiSearch } as unknown as TypesenseClient, 'explore');
    const ids = await retrieval.findPostIds({ places: ['da-lat'], tags: ['fyp', 'homestay'], postType: 'video', hasPlan: false, limitPerSource: 150 });
    expect(ids).toEqual(['A', 'B']);
    expect(multiSearch).toHaveBeenCalledWith(
      [
        expect.objectContaining({ filter_by: 'vertical:=`videos` && place_buckets:=[`Đà Lạt`]', include_fields: 'id', per_page: 150 }),
        expect.objectContaining({ filter_by: 'vertical:=`videos` && (tags_folded:=[`homestay`] || terms:=[`homestay`])' }),
      ],
      { collection: 'explore' },
    );
  });

  it('không còn nơi/tag dùng được thì không gọi Typesense', async () => {
    const multiSearch = vi.fn();
    const retrieval = new TypesenseTasteRetrieval({ multiSearch } as unknown as TypesenseClient);
    expect(await retrieval.findPostIds({ places: [], tags: ['fyp'], postType: null, hasPlan: false, limitPerSource: 150 })).toEqual([]);
    expect(multiSearch).not.toHaveBeenCalled();
  });

  it('search con lỗi thì ném (use case bắt và dùng hot/fresh)', async () => {
    const multiSearch = vi.fn(async () => [{ code: 400, error: 'bad filter' }]);
    const retrieval = new TypesenseTasteRetrieval({ multiSearch } as unknown as TypesenseClient);
    await expect(retrieval.findPostIds({ places: ['da-lat'], tags: [], postType: null, hasPlan: false, limitPerSource: 10 })).rejects.toThrow('bad filter');
  });

  it('mode has_plan: chỉ lấy bài có lịch trình (section plan), khỏi lấy về rồi bị Postgres bỏ', async () => {
    const multiSearch = vi.fn(async () => [{ hits: [] }]);
    const retrieval = new TypesenseTasteRetrieval({ multiSearch } as unknown as TypesenseClient);
    await retrieval.findPostIds({ places: ['da-lat'], tags: [], postType: null, hasPlan: true, limitPerSource: 150 });
    expect(multiSearch).toHaveBeenCalledWith(
      [expect.objectContaining({ filter_by: 'vertical:=[`plans`,`videos`] && sections:=[`plan`] && place_buckets:=[`Đà Lạt`]' })],
      { collection: 'explore' },
    );
  });
});
