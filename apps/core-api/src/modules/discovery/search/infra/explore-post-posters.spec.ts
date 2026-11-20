import { describe, expect, it, vi } from 'vitest';
import { withVideoPosters } from './explore-post-posters.js';

const poster = (id: string) => ({ posters: { w360: `https://cdn/${id}/poster_360.jpg` } });

describe('withVideoPosters', () => {
  it('bài video lấy poster của video đầu tiên phát được, bài khác và video chưa sẵn sàng nhận null', async () => {
    const getPlayback = vi.fn(async () => ({ V2: poster('V2'), V3: poster('V3') }));
    const page = await withVideoPosters(
      {
        items: [
          { id: 'P1', postType: 'video', mediaIds: ['V1', 'V2', 'V3'] },
          { id: 'P2', postType: 'video', mediaIds: ['V9'] },
          { id: 'P3', postType: 'vlog', mediaIds: ['I1'] },
        ],
        nextCursor: 'c2',
      },
      getPlayback,
    );
    expect(getPlayback).toHaveBeenCalledWith(['V1', 'V2', 'V3', 'V9']);
    expect(page.nextCursor).toBe('c2');
    expect(page.items.map((p) => [p.id, p.posterUrl])).toEqual([
      ['P1', 'https://cdn/V2/poster_360.jpg'],
      ['P2', null],
      ['P3', null],
    ]);
  });

  it('trang không có video thì không đọc media', async () => {
    const getPlayback = vi.fn();
    const page = await withVideoPosters({ items: [{ postType: 'vlog', mediaIds: ['I1'] }], nextCursor: null }, getPlayback);
    expect(getPlayback).not.toHaveBeenCalled();
    expect(page.items[0]!.posterUrl).toBeNull();
  });
});
