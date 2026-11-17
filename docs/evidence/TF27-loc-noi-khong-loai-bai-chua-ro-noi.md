# TF27 — Tìm theo nơi không loại bài chưa rõ nơi

- Jira: SCRUM-31 (TF27) · Nhánh: `duy/TF27-loc-noi-khong-loai-bai-chua-ro-noi` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-16

## Đã làm
- Lỗi phát hiện từ dữ liệu thật: video caption "Hôm nay bay ra hà lội học AI nhe ae" không ra khi tìm "hà nội", kể cả ở kết quả thay thế. Nguyên nhân: nơi của bài chỉ lấy từ `destinationName` + `title`, caption nằm ở `body`, nên phần lớn video có `place = null`, không có toạ độ, và bị bộ lọc nơi loại hẳn (`rank.ts`, câu SQL lọc ứng viên).
- Bài chưa rõ nơi mà **nhắc tới** nơi trong câu tìm (theo mọi bí danh trong lexicon; bí danh nhiều chữ như "hồ chí minh" phải khớp đủ các cặp chữ liền nhau) được coi như đúng nơi, lý do hiển thị "Nhắc tới <nơi>".
- Bài chưa rõ nơi, không nhắc nơi nhưng khớp từ chính: chỉ vào **kết quả thay thế** (`relaxed: ['place']`), xếp sau bài gần nơi, phạt bằng bài ở mép `FAR_KM`, lý do "Chưa rõ nơi". Câu chỉ có tên nơi thì không lấy thêm (tránh quét cả bảng).
- Bài đã biết ở nơi khác vẫn bị loại như cũ.
- Thêm bí danh `ha loi` → Hà Nội trong `lexicon-rows.ts`.
- Lọc ứng viên sửa đồng thời ở SQL (`drizzle-explore.store.ts`) và bản RAM (`memory-source.ts`) để hai bản giữ cùng điều kiện.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Tìm "hà nội" ra video chỉ nhắc Hà Nội / "hà lội" trong caption | ✅ | test `bài chưa rõ nơi mà nhắc tới nơi trong câu thì vẫn ra; "hà lội" là Hà Nội` |
| Tìm "sài gòn" ra caption "Hồ Chí Minh", không ra "anh Chí Minh" | ✅ | cùng test trên |
| Dữ liệu ít: "phở hà nội" có kết quả thay thế từ bài chưa rõ nơi; "hà nội" không kéo bài chưa rõ nơi | ✅ | test `dữ liệu ít: bài chưa rõ nơi khớp từ chính chỉ vào kết quả thay thế, xếp sau bài gần nơi` |
| Không làm hỏng hành vi cũ | ✅ | toàn bộ test discovery, gồm typo-bench và typo-regression |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --filter=@tripflix/core-api`: 13/13 task thành công; 111 file test pass, 2 skip (parity Python cần dữ liệu ngoài repo). Lint 0 lỗi, không có cảnh báo ở file đã sửa (112 cảnh báo có sẵn ở file khác).
- `vitest run src/modules/discovery`: 188 test pass, 4 skip.
- Hai test mới fail trước khi sửa (`hà nội` ra 0 video; `fallback` là null) và pass sau khi sửa.
- Chưa so điểm trên bộ 50 câu TF13 (chưa có script chấm tự động).

## Cách kiểm lại
1. `cd apps/core-api && npx vitest run src/modules/discovery/search/domain/explore/explore.spec.ts`
2. Trên stack: chạy lại job dựng chỉ mục tìm khám phá (lexicon có thêm dòng), rồi tìm "hà nội", "hà lội", "phở hà nội" ở tab bài đăng.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa trong `discovery/search` (Duy). Thay đổi hành vi: câu tìm có tên nơi sẽ ra thêm bài/video chưa rõ nơi (kết quả chính nếu có nhắc nơi, kết quả thay thế nếu không).
- Giới hạn còn lại: `parity` với prototype Python sẽ lệch ở các câu có nơi (test này chỉ chạy khi có `EXPLORE_PARITY_DIR`).
