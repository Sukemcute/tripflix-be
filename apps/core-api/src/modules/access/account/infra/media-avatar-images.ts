import type { ModuleRef } from '@nestjs/core';
import type { AvatarImages } from '../../auth/application/ports.js';

/**
 * Kiểm ảnh đại diện bằng MediaFacade của content (TF109). Import lúc gọi vì content đã import access, import tĩnh
 * thành vòng; lấy facade lúc gọi để test chỉ dựng access không cần module content. Không có content: coi như ảnh sai.
 */
export function createMediaAvatarImages(moduleRef: Pick<ModuleRef, 'get'>): AvatarImages {
  return {
    async findOwnedImageUrl(ownerId, mediaId) {
      const { MediaFacade } = await import('../../../content/index.js');
      let media: InstanceType<typeof MediaFacade>;
      try {
        media = moduleRef.get(MediaFacade, { strict: false });
      } catch {
        return null;
      }
      const [info] = await media.getKinds([mediaId]);
      if (info?.ownerId !== ownerId || info.kind !== 'image') return null;
      return (await media.getImages([mediaId]))[mediaId]?.url ?? null;
    },
  };
}
