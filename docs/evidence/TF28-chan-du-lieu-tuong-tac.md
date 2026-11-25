# TF28 — Chặn và dọn dòng tương tác để job gợi ý không làm treo API

- Jira: TF28 · Nhánh: `duy/TF28-chan-du-lieu-tuong-tac` · Người làm: Lê Anh Duy (dùng AI: có) · Ngày: 2026-11-25

## Bối cảnh

Phong báo BuildFeaturesJob chạy rất lâu và chặn API khi `APP_ROLE=all`. Bảng `recommend_interactions` không có trần dòng mỗi người: các loại `search`, `stays_search`, `share`, `booking_click` lấy `ref_id = eventId`, nên mỗi lần tìm thêm một dòng. Một người, bot hay stress test đã đăng nhập có thể tạo hàng chục nghìn dòng. Job tính đặc trưng và feed (`loadViewer`) đều đọc hết số dòng đó vào RAM. PR này chặn và dọn trước; sửa `groupBy` O(N²) làm ở PR sau.

## Đã làm

Trần đặt chung ở `recommend/domain/row-limits.ts`.

1. **Chặn lúc đọc**: `listUserRows` chỉ lấy 300 dòng chỉ-thêm mới nhất và 2.000 dòng loại khác, mỗi người mỗi loại (`row_number() over (partition by actor_id, kind …)`). Bảng có phình thì RAM của job và feed vẫn có trần.
2. **Dọn phần thừa**: job `recommend_purge` thêm bước `purgeExcess`, xoá theo lô 5.000 các dòng chỉ-thêm vượt 300 dòng mới nhất mỗi người mỗi loại. Hàm cửa sổ chỉ chạy trên các nhóm vượt trần. Admin bấm "Chạy ngay" để dọn ngay.
3. **Chặn lúc nạp**: `RecommendIngestUseCases` đếm số dòng chỉ-thêm theo (người, loại, ngày UTC) bằng Redis `INCRBY` + hết hạn 2 ngày; quá 500 thì bỏ phần vượt và ghi cảnh báo một lần. Redis lỗi thì nạp như cũ, vì trần lúc đọc và job dọn vẫn chặn phía sau.
4. **Cầu chì cho job**: nhường event loop (`setImmediate`) giữa các lô 200 người; lượt quá 5 phút thì dừng phần người dùng. Người chưa tính giữ đặc trưng cũ, lỗi ghi vào `last_error` / Admin Jobs.

## Đối chiếu "Xong khi"

| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Một người có rất nhiều dòng không làm job/feed đọc hết vào RAM | Có | `drizzle-recommend.store.int.spec.ts` "listUserRows: chỉ đọc APPEND_ONLY_KEEP…"; DB local 50.000 dòng `search` một người: đọc ra 300 dòng (48 ms) |
| Dữ liệu đã phình được dọn | Có | int spec "purgeExcess: xoá theo lô…"; DB local xoá 49.700 dòng trong 10 lô, 483 ms, người dưới trần không bị đụng |
| Chặn từ nguồn, Redis lỗi không làm mất sự kiện | Có | `ingest.use-cases.spec.ts` (4 test: trần, sang ngày, Redis lỗi, không có bộ đếm) |
| Job không giữ worker quá lâu, không chặn event loop giữa các lô | Có | `build-features.use-cases.spec.ts` "quá ngân sách thời gian…", "chạy đủ các lô 200 người…" |

## Kết quả kiểm tra

- `pnpm turbo run lint typecheck test --filter=@tripflix/core-api --concurrency=2`: lint 0 lỗi (135 cảnh báo có sẵn, không cảnh báo nào ở file của PR); typecheck đạt. Test 3.135 pass, 9 fail, 83 skip; cả 9 fail đều là hết thời gian chờ khi máy tải nặng, ở các file e2e của access, content, commerce và `recommend-eval`. Chạy riêng 11 file đó: 140/140 pass.
- `vitest run -c vitest.int.config.ts drizzle-recommend.store.int.spec.ts` (Postgres thật, Testcontainers): 15/15 pass.

## Cách kiểm lại

1. `pnpm --filter @tripflix/core-api exec vitest run src/modules/discovery/recommend`
2. `pnpm --filter @tripflix/core-api exec vitest run -c vitest.int.config.ts src/modules/discovery/recommend/infra/drizzle-recommend.store.int.spec.ts`
3. Trên staging, xem mức phình trước khi deploy:
   `select kind, count(*), max(c) from (select kind, actor_id, count(*) c from discovery.recommend_interactions where occurred_at > now()-interval '30 days' group by 1,2) s group by 1 order by 3 desc;`
   Sau deploy, bấm "Chạy ngay" job `recommend_purge` ở Admin Jobs; chạy lại câu trên, `max` của các loại chỉ-thêm ≤ 300.

## Ảnh / video

- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác

- Không. Chỉ sửa trong `discovery`. Không đổi API, sự kiện hay schema DB (dùng khoá chính sẵn có, không cần migration).
- Hạ tầng (Phong, không nằm trong PR): trên server nên tách tiến trình `APP_ROLE=worker`, để job nặng không chạy chung tiến trình với API.
