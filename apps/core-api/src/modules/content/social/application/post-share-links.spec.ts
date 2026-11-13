import { describe, expect, it } from 'vitest';
import { PostShareLinks } from './post-share-links.js';

describe('PostShareLinks', () => {
  it('bài viết mở trang Cảm hứng với bài mở sẵn, theo địa chỉ web của môi trường', () => {
    const links = new PostShareLinks('https://tripflix.io.vn');
    expect(links.buildUrl('post-1', 'vlog')).toBe('https://tripflix.io.vn/inspiration?open=post-1');
  });

  it('Reel thêm kind=reel để web mở trong trình xem Reels', () => {
    const links = new PostShareLinks('https://tripflix.io.vn');
    expect(links.buildUrl('reel-1', 'video')).toBe('https://tripflix.io.vn/inspiration?open=reel-1&kind=reel');
  });

  it('bỏ dấu / cuối của địa chỉ web; không cấu hình thì dùng web dev', () => {
    expect(new PostShareLinks('https://tripflix.io.vn/').buildUrl('p', 'vlog')).toBe(
      'https://tripflix.io.vn/inspiration?open=p',
    );
    expect(new PostShareLinks().buildUrl('p', 'vlog')).toBe('http://localhost:3100/inspiration?open=p');
  });
});
