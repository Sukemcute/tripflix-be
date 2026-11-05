# TF09 — Sửa test ffmpeg lỗi trên Windows

- Notion: không có task riêng, thuộc TF09 · Nhánh: `phong/TF09-ffmpeg-spec-windows` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-06

## Đã làm
- `ffmpeg.spec.ts` so sánh đường dẫn đầu ra bằng `join(input.outputDir, ...)` thay vì chuỗi `/tmp/360p/...`. Duy báo test đỏ trên Windows vì code tạo đường dẫn `\tmp\360p\...`, còn CI chạy Linux nên vẫn xanh.
- Không đổi code chạy: `outputDir` là thư mục thật trên máy, tạo từ `tmpdir()`, nên `path.join` là đúng. Key S3 được ghép riêng bằng `/`, không qua `path.join`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Test không còn phụ thuộc dấu phân cách của hệ điều hành | Đạt ở mô phỏng | Thay `node:path` bằng `path.win32` trong một bản spec tạm: bản sửa 14/14 test đạt; khôi phục chuỗi cũ thì test này lỗi với `\tmp\360p\seg_%03d.ts` |
| Vẫn kiểm tra đúng thư mục và tên file | Đạt | Giá trị mong đợi vẫn gồm `outputDir` và tên file đầy đủ |
| Không ảnh hưởng Linux/macOS | Đạt | `@tripflix/video-worker`: 49/49 test đạt trên macOS |

## Kết quả kiểm tra
`pnpm turbo run lint typecheck test --filter=@tripflix/video-worker`: 10/10 task đạt, lint 0 warning và 0 error, 49/49 test đạt.

Chưa chạy trên máy Windows thật.

## Cách kiểm lại
1. Trên Windows, chạy `pnpm --filter @tripflix/video-worker test`.
2. Kết quả mong đợi: `ffmpeg.spec.ts` đạt.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa test của `video-worker`.
