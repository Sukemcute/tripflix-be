/** Thư mục gốc (tương đối, chưa có tiền tố môi trường) của ảnh khách sạn giả lập trên kho media. */
// CloudFront chỉ phát công khai dev/*/images/* (deploy/aws/bucket-policy.template.json), nên ảnh khách sạn nằm dưới images/.
export const HOTEL_IMAGE_KEY_ROOT = 'images/hotels';

/**
 * Dữ liệu nguồn ghi ảnh dạng "/images/<thư mục>/<file>". Đổi sang khoá tương đối trên kho media:
 * "images/hotels/<thư mục>/<file>". Giá trị khác (đã là URL đầy đủ) giữ nguyên.
 */
export function toHotelImageKey(sourcePath: string): string {
  if (/^https?:\/\//.test(sourcePath)) return sourcePath;
  return `${HOTEL_IMAGE_KEY_ROOT}/${sourcePath.replace(/^\/?images\//, '')}`;
}
