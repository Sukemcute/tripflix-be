# TF99 — Bài đông không xếp hàng khoá dòng bài (mục 2.4, bước 2)

- Jira: TF99 · Nhánh: `thanh/TF99-dem-so-binh-luan-bai-nong` (phụ thuộc PR #235) · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-17

## Đã làm
- Lượt thêm bình luận thử khoá dòng bài **không chờ** (`FOR NO KEY UPDATE SKIP LOCKED`):
  - **Lấy được ngay (bài vắng):** cộng `comment_count` ngay, như bước 1.
  - **Đang có người giữ (bài đông):** INSERT bình luận (khoá ngoại giữ nhẹ dòng bài ở mức KEY SHARE nên ẩn, xoá cả luồng đến sau vẫn phải chờ), kiểm lại bài và bình luận gốc **sau** INSERT (xoá, ẩn xong trước đó thì rollback), ghi `+1` vào bảng mới `content.post_counter_deltas`.
- `FlushCommentCountsJob` (vai trò `worker`/`all`) mỗi 1 giây gọi `FlushCommentCountsUseCase`: một câu SQL lấy và xoá tối đa 5.000 dòng đệm, cộng tổng theo bài vào `comment_count`. Khoá advisory trong transaction để mỗi lượt chỉ một bản worker cộng (tránh khoá chết khi hai bản cập nhật nhiều bài theo thứ tự khác nhau).
- Bình luận bị giữ chờ duyệt, xoá, sửa, kiểm duyệt: không đổi luồng.
- Mọi lượt đổi `comment_count` qua `PostRepository.incrementCounter` (xoá, sửa bình luận bị giữ, kiểm duyệt) gộp luôn phần đệm của bài trong cùng câu. Lỗi tìm ra khi chạy cả bộ test: xoá gốc lúc 8 trả lời còn trong bảng đệm thì trừ 9 trên số 1, `GREATEST(0, …)` chặn về 0, job cộng thêm 8 → còn 0 bình luận mà số đếm là 8.
- Job cộng dồn khoá các dòng bài (theo thứ tự id) trước rồi mới lấy dòng đệm của đúng các bài đó; làm ngược lại thì khoá chết với lượt xoá đang giữ dòng bài và gộp phần đệm.
- Migration mới `20261117051316_post_counter_deltas` (chỉ tạo bảng), bảng có trong schema Drizzle. Đã báo anh Phong, Trang.
- Lý do chọn và các hướng đã bỏ (KEY SHARE gây khoá chết, đệm mọi lượt làm lệch số khi kiểm duyệt): artifact "Bình luận chịu tải và realtime", mục 2.4.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Bài đông không xếp hàng | Đạt | `post-row-lock.int.spec.ts` › "dòng bài đang bị giữ: lượt gửi không chờ…"; W1: mẫu có phiên chờ khoá 66% → 29% |
| Số bình luận đúng, chậm ≤ ~1 s | Đạt | Test 30 người gửi: đã cộng + đang đệm = 30, sau job = 30; 3 job chạy cùng lúc không cộng trùng. Sau W1: `comment_count` 19.154 = 19.154 bình luận thật. Tuổi dòng đệm cũ nhất p95 0,97 s |
| Không chen trả lời vào luồng đang xoá | Đạt | Test "gửi trả lời cùng lúc với xoá gốc" (5 vòng); unit "bài đông nhưng bài vừa bị ẩn" |
| Xoá, ẩn bình luận khi còn phần đệm: số không lệch | Đạt | Test "xoá gốc khi các trả lời còn nằm trong bảng đệm" (code cũ: 8, sau sửa: 0); "xoá bình luận cùng lúc với lượt cộng dồn: không khoá chết"; test tranh chấp xoá gốc chạy cả bộ 3/3 lần |
| Bài vắng, kiểm duyệt không đổi hành vi | Đạt | Test "một người gửi một mình: cộng ngay"; `moderation.int.spec.ts`, `pre-publication.int.spec.ts` pass không sửa |

## Kết quả đo W1 (người gửi liên tục vào cùng một bài, trung vị 3 lần, tắt tracing, cùng máy trong ngày)
| Người gửi | develop | Bước 1 (#235) | Bước 2 (nhánh này) |
|---:|---|---|---|
| 1 | 60/s · p95 30 ms | 53/s · 34 ms | 63/s · 27 ms |
| 2 | 78/s · 42 ms | 106/s · 34 ms | 83/s · 48 ms |
| 5 | 89/s · 144 ms | 99/s · 91 ms | **123/s · 67 ms** |
| 10 | 86/s · 191 ms | 119/s · 210 ms | **158/s · 96 ms** |
| 25 | 114/s · 291 ms | 124/s · 373 ms | **169/s · 217 ms** |
| Mẫu có phiên chờ khoá | 71% | 66% | **29%** |

Độ chậm của số đếm (lấy mẫu bảng đệm trong lúc đo, chỉ lúc có dòng chờ): tuổi dòng cũ nhất p50 0,53 s, p95 0,97 s, p99 1,03 s, tối đa 1,58 s; số dòng đệm p95 122, tối đa 236.

Lưu ý: bộ lấy mẫu gọi `docker exec` liên tục nên tốn thêm CPU trong lúc đo bước 2 (số bước 2 có thể hơi thấp hơn thực tế). Quét tuần tự bảng `posts` tăng (0 → 3,25 mỗi request) do câu cộng dồn `UPDATE … FROM` trên bảng `posts` nhỏ ở local; theo dõi lại trên dữ liệu thật.

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49/49 (lần đầu 48/49, core-api test hết thời gian khi chạy song song cả repo; chạy lại riêng: 2656 pass, 4 skip có sẵn; chạy lại cả repo 49/49).
- Test tích hợp content 107/107, chạy cả bộ 3 lần liên tiếp đều pass (trước khi sửa: test tranh chấp "trả lời cùng lúc với xoá gốc" fail 3/3 khi chạy cả bộ vì số đếm lệch 7–21); `post-row-lock.int.spec.ts` 9/9.
- Sau khi sửa: `pnpm turbo run lint typecheck test --affected` 49/49 (core-api 2661 pass, 4 skip có sẵn).

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api db:migrate`.
2. `pnpm --filter @tripflix/core-api exec vitest run --config vitest.int.config.ts src/modules/content/social/application/use-cases/post-row-lock.int.spec.ts`.
3. Bộ đo `tools/bench/comments/run.sh wsweep` (nhánh `thanh/TF99-benchmark-binh-luan`).

## Ảnh / video
- Không đính kèm.

## Ảnh hưởng tới phần của người khác
- `content/db` dùng chung (anh Phong, Trang): thêm bảng `post_counter_deltas` và migration mới, đã báo.
- `moderation/change-visibility` (Trang) gọi `incrementCounter` để đổi số bình luận: giờ gộp thêm phần đệm của bài, không đổi chữ ký hàm; test kiểm duyệt pass không sửa.
- Khoá trong `add-comment` (Trang thêm): bài vắng giữ nguyên; bài đông dựa vào khoá ngoại + kiểm lại sau INSERT, đã báo Trang. Test kiểm duyệt của Trang pass không sửa.
