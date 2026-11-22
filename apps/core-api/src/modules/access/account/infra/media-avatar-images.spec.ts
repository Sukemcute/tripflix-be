import { createMediaAvatarImages } from './media-avatar-images.js';

// Không nạp cả module content (chậm); facade giả trả qua moduleRef bên dưới.
vi.mock('../../../content/index.js', () => ({ MediaFacade: class {} }));

const OWNER = 'owner-1';
const facade = {
  getKinds: async (ids: string[]) =>
    [
      { id: 'img', ownerId: OWNER, kind: 'image', status: 'ready' },
      { id: 'video', ownerId: OWNER, kind: 'video', status: 'ready' },
      { id: 'pending', ownerId: OWNER, kind: 'image', status: 'uploading' },
    ].filter((k) => ids.includes(k.id)),
  // Như MediaFacade.getImages: chỉ ảnh đã tải xong.
  getImages: async (ids: string[]) => (ids.includes('img') ? { img: { url: 'https://cdn/img.jpg', widthPx: null, heightPx: null } } : {}),
};

describe('TF109: kiểm ảnh đại diện qua MediaFacade', () => {
  const avatars = createMediaAvatarImages({ get: () => facade } as never);

  it('chỉ nhận ảnh đã tải xong của chính mình', async () => {
    expect(await avatars.findOwnedImageUrl(OWNER, 'img')).toBe('https://cdn/img.jpg');
    expect(await avatars.findOwnedImageUrl('nguoi-khac', 'img')).toBeNull();
    expect(await avatars.findOwnedImageUrl(OWNER, 'video')).toBeNull();
    expect(await avatars.findOwnedImageUrl(OWNER, 'pending')).toBeNull();
    expect(await avatars.findOwnedImageUrl(OWNER, 'khong-co')).toBeNull();
  });

  it('không có module content: coi như ảnh sai', async () => {
    const missing = createMediaAvatarImages({ get: () => { throw new Error('không có'); } } as never);
    expect(await missing.findOwnedImageUrl(OWNER, 'img')).toBeNull();
  });
});
