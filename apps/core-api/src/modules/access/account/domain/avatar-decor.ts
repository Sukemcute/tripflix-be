/**
 * Khung và phụ kiện bọc ngoài ảnh đại diện (TF109). Danh sách khung, sticker do web/app định nghĩa: server chỉ kiểm
 * định dạng và giới hạn, không kiểm tên có thật không (app gặp tên lạ thì bỏ qua).
 */
export const AVATAR_DECOR_MAX_STICKERS = 12;
/** Mã khung, mã sticker: chữ thường, số, gạch ngang (vd. fox-hat). */
export const AVATAR_DECOR_ID_PATTERN = /^[a-z0-9-]{1,40}$/;
/** Toạ độ tâm sticker theo vòng tròn avatar (0..1 là trong vòng), cho tràn ra ngoài một khoảng. */
export const AVATAR_STICKER_POS_MIN = -1;
export const AVATAR_STICKER_POS_MAX = 2;
export const AVATAR_STICKER_SCALE_MIN = 0.5;
export const AVATAR_STICKER_SCALE_MAX = 2.4;

export interface AvatarSticker {
  instanceId: string;
  presetId: string;
  x: number;
  y: number;
  scale: number;
  rotationDeg: number;
  isFlipped: boolean;
}

export interface AvatarDecor {
  /** 'none': không khung. */
  frameId: string;
  stickers: AvatarSticker[];
}
