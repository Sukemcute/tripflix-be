# TF23 — Sự kiện xem Reels, bấm đặt từ Reels, FeedFacade (phần BE của Phong)

- Jira: SCRUM-27 · Nhánh: `phong/TF23-su-kien-xem-reels` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-16, kiểm lại 2026-11-17
- Chia việc TF23 với Duy: Duy làm điểm xu hướng `hot@v1` trong discovery; Phong làm sự kiện xem thật, sự kiện bấm đặt và hàm lấy thẻ Reels cho discovery.

## Đã làm
- `POST /api/v1/feed/events`: app gửi lô sự kiện hành vi (tối đa 50), khách cũng gửi được (`X-Anon-Id` tuỳ chọn), trả `202 { accepted }`. Theo F4 Ingest trong `docs/architecture/10-nghiep-vu-kien-truc-feed.md`: chỉ đẩy vào `stream:app-events`, không ghi bảng nào.
- Hai sự kiện mới trong `libs/contracts`: `content.post.viewed` v1 (`watchedMs`, `durationSec`, `isQualified`, `surface`) và `content.post.booking_clicked` v1 (`hotelId`, `surface`). `eventId` giữ đúng mã app sinh để bên nhận loại trùng khi app gửi lại.
- "Xem thật" (`isQualified`) tính ở BE: xem từ 15 giây hoặc từ nửa thời lượng (`feed/domain/view-rules.ts`). Thời lượng lấy từ media, không tin app.
- Chỉ nhận sự kiện của bài đang xem được trên feed (dùng lại `FeedUseCases.getByIds`), nên không thổi được lượt xem cho bài ẩn, riêng tư, đã xoá hay không tồn tại.
- Ghi stream lỗi chỉ ghi log, request vẫn trả 202: mất vài lượt xem không đáng để app phải gửi lại.
- `stream:app-events` giới hạn 50.000 mục (stream nghiệp vụ 100.000), vì analytics giữ bản lâu dài.
- `FeedFacade.getByIds(postIds, viewerId)` export ở `content/index.ts` (kèm type `FeedCard`, `FeedPage`): discovery của Duy trả bảng xu hướng kèm thẻ phát được trong một request.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Có tín hiệu "đã xem thật" cho chống lặp và xu hướng | Có | `feed.e2e.spec.ts` › TF23: khách gửi lượt xem…; `view-rules.spec.ts` |
| Có tín hiệu bấm khách sạn/đặt từ video | Có | `feed.e2e.spec.ts` › TF23: người đã đăng nhập bấm đặt… |
| Không nhận bài không xem được, lô sai thì 400 | Có | `feed.e2e.spec.ts` › TF23: lô rỗng, quá 50…; bài không tồn tại bị bỏ (accepted 2/3) |
| Redis lỗi không làm hỏng request của app | Có | `feed-events.use-cases.spec.ts` |
| Discovery lấy được thẻ Reels theo id | Có | `FeedFacade` dùng lại `getByIds` (đã có test int ở PR #177) |

## Kết quả kiểm tra
- 17/11, sau khi ghép vào `develop` `323e562` (giải xung đột `libs/contracts/src/index.spec.ts` với TF99, giữ cả hai): `pnpm contracts:build` ra OpenAPI giống bản đã commit; `pnpm turbo run lint typecheck test --affected` 49/49 tác vụ đạt; core-api 2654 test đạt, 4 skipped (có từ trước); contracts 23 test đạt.
- Test int feed trên Postgres thật: 20/20 đạt.
- `pnpm contracts:build`: thêm `contracts/events/content.post.viewed.v1.schema.json`, `content.post.booking_clicked.v1.schema.json`, cập nhật `contracts/openapi/core-api.json`.

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api exec vitest run src/modules/content/feed`.
2. Trên staging sau khi deploy, xem một reel hơn 15 giây trên app, rồi chạy `dc exec -T redis redis-cli XREVRANGE stream:app-events + - COUNT 5`: thấy `content.post.viewed` với `isQualified: true`.

## Chưa làm
- Giới hạn 30 request/phút mỗi thiết bị (tài liệu mục 6): hiện chỉ có `rate-limit-api` chung ở Traefik và giới hạn 50 sự kiện mỗi lô.
- Discovery chưa nghe `stream:app-events` (phần Duy: thêm `STREAMS.appEvents` vào `DISCOVERY_STREAMS`). Analytics (Trang) chưa có consumer.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- `libs/contracts` (chung): chỉ thêm schema, không đổi schema cũ. Cần báo Trang (analytics) và Duy (discovery) về hai sự kiện mới.
- `content/content.module.ts`, `content/index.ts`: chỉ thêm export `FeedModule`/`FeedFacade`, không đổi export cũ.
