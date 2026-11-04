# libs/storage

Interface `ObjectStorage`: ký URL tải lên nhiều phần, đọc, ghi, tạo link CDN. Adapter S3 (bucket dev `tripflix-media-dev`) và adapter bộ nhớ cho test (docs/architecture/11 Q9).

- Phụ trách: Phong

## Dùng trong app

```ts
import { S3ObjectStorage } from '@tripflix/storage';

const storage = new S3ObjectStorage({
  region: env.AWS_REGION,
  bucket: env.S3_MEDIA_BUCKET,
  keyPrefix: env.S3_KEY_PREFIX,
  cdnBaseUrl: env.MEDIA_CDN_URL,
});
```

Key AWS lấy từ biến môi trường `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. Test dùng `InMemoryObjectStorage`, không cần mạng.

## Quy ước khoá

Chỉ gọi `resolveKey` một lần, lúc tạo khoá. Mọi hàm còn lại nhận khoá đầy đủ, và giá trị lưu trong database hay gửi qua sự kiện cũng là khoá đầy đủ. Nhờ vậy `video-worker` đọc được đúng file mà không phải ghép tiền tố lần nữa.

## Lỗi

| Lỗi | Khi nào |
|---|---|
| `UploadExpiredError` | Phiên upload không còn trên S3 |
| `UploadIncompleteError` | Thiếu phần, sai thứ tự, ETag không khớp, hoặc có phần nhỏ hơn mức tối thiểu của S3 |
| `ObjectNotFoundError` | File không tồn tại |
