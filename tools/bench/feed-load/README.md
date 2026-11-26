# Đo tải feed trên staging (TF120)

Ba phép đo, mỗi phép chứng minh một quyết định kiến trúc của feed (`docs/architecture/10-nghiep-vu-kien-truc-feed.md`). Bắn từ VM `tripflix-k6` cùng region với staging, để số đo không lẫn độ trễ mạng nhà.

| Phép              | Kịch bản       | Cần chứng minh                                                                                                            |
| ----------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1. Video qua CDN  | `k6/cdn.js`    | Người xem tăng 50 → 500, băng thông video tăng theo nhưng CPU core-api gần như không đổi, vì video đi thẳng từ CloudFront |
| 2. 1 → 2 core-api | `k6/scale.js`  | Tốc độ bền vững (p95 < 500 ms, lỗi < 1%) của lướt feed tăng khi thêm bản core-api                                         |
| 4. Ghi qua stream | `k6/events.js` | Bắn dồn lượt xem, API vẫn trả nhanh; lag stream dâng lên rồi về 0                                                         |

Bản đo trên stack local theo số bài video vẫn ở `tools/bench/feed/`.

## Không làm bẩn dữ liệu

- Mọi request là **khách**, không tạo tài khoản, không phải dọn sau buổi đo.
- Phép 4 gửi lượt xem dưới 2 giây trên bài dài ít nhất 4 giây: không đạt "xem đủ" (15 giây hoặc 50%) nên không vào điểm hot (`content/feed/domain/trend-signal.ts`); discovery bỏ qua khách (`discovery/recommend/domain/ingest/to-raw-rows.ts`). Analytics vẫn đếm: báo Trang trước buổi đo.
- `stream:app-events` chỉ giữ khoảng 100.000 sự kiện (MAXLEN trong `libs/event-bus`). `events.js` tính trước số sự kiện và dừng nếu quá 60.000 (500 VU mặc định: khoảng 56.000).
- Phép 1 tốn phí CloudFront: 500 người × 2 phút khoảng 4–8 GB, dưới 1 USD.

## Trước buổi đo

1. Báo team không deploy staging trong giờ đo.
2. Bật VM: `gcloud compute instances start tripflix-k6 --zone=asia-southeast1-b`, chép thư mục này lên (`tar` rồi `gcloud compute scp --tunnel-through-iap`).
3. Server: backup `deploy/traefik/server.yml`, thêm router bỏ rate limit cho IP VM (`34.87.38.71`) như `tools/loadtest/README.md`, ghi bằng `cat file.moi > server.yml`.
4. Server: chép `sample.sh`, chạy nền (lệnh ở đầu file). Mẫu nằm ở `~/bench/feed-<giờ UTC>/`.

## Chạy (trên VM k6)

```bash
sh run.sh scale c1        # cấu hình 1: 1 bản core-api APP_ROLE=all. RATES="50 100 200 400", mỗi mức 60 s
# đổi staging sang 2 api + 1 worker (compose.bench.yaml của buổi đo bình luận, thêm core-api-2 vào service Traefik)
sh run.sh scale c2
sh run.sh cdn             # LEVELS="50 100 250 500", mỗi mức 2 phút
sh run.sh events          # VUS=500: 30 s tăng, 60 s giữ; đợi lag về 0 rồi mới dừng sampler
```

Mức nào lỗi quá 5% hoặc p95 quá 3 giây thì dừng, không bắn mức cao hơn. Mỗi lượt nghỉ `REST` giây (mặc định 30).

## Sau buổi đo

1. Dừng sampler, chép `~/bench/feed-<giờ>/` và `out/` của VM về máy.
2. `node tools/bench/feed-load/analyze.mjs <out> <thư mục mẫu>`: in bảng, ghi `series.json` để vẽ biểu đồ.
3. Trả `server.yml` từ backup, kiểm `grep -c loadtest-bypass` = 0 và bắn thử thấy 429.
4. Trả core-api về 1 bản `all`, gỡ `core-api-2`, `core-api-worker`. Tắt VM k6.

## Đọc kết quả

- **Đạt req/s thấp hơn mục tiêu** (phép 2): server không theo kịp, k6 hết VU để gửi.
- **Trúng cache** (phép 1): theo header `X-Cache` của CloudFront. Đoạn trượt cache đi về S3 ở Sydney nên chậm hơn nhiều (khoảng 550–760 ms).
- **CPU %**: đơn vị là % của 1 core (`docker stats`), cộng mọi container `core-api*`; bỏ 20 giây đầu mỗi lượt.
- **Về 0 sau** (phép 4): từ lúc k6 dừng tới mẫu đầu tiên mọi nhóm của `stream:app-events` đọc hết.
