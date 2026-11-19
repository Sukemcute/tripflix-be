# TF28 — Gợi ý for-you v1: trả lời câu hỏi du lịch theo giai đoạn chuyến đi

- Notion: TF28 · Nhánh: `duy/TF28-for-you-uu-tien-dia-diem` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-19

## Vấn đề

Feed for-you v0 lấy bài thịnh hành rồi xếp theo tag người dùng từng thích.
- Người đang lên kế hoạch đi Nha Trang gần như không thấy bài Nha Trang: bài đó không nằm trong nhóm thịnh hành nên không bao giờ được xét.
- Lý do hiện cho người dùng là hashtag, ví dụ "Vì bạn thích chủ đề #fyp".

## Đã làm

v1 là bộ ba mới cắm vào khung có sẵn (`registry.ts`, `recommend_algos`):

| Thành phần | Vai trò |
|---|---|
| `post_profile@v1` | Builder bài |
| `trip_profile@v1` | Builder người dùng |
| `trip_v1` | Ranker |

Endpoint, tham số và JSON trả về không đổi. Bước bật v1 làm sau: chạy migration dữ liệu đổi `for_you` sang bộ ba mới.

- **Ngăn (bins).** Mỗi bài được xếp vào các ngăn theo câu hỏi du lịch:
  - `place`: đi đâu.
  - `exp`: làm gì; có 9 ngăn như biển, núi, ăn uống, cà phê…
  - `cost`: tốn bao nhiêu.
  - `with`: đi với ai.
  - `len`: đi mấy ngày.
  - `season`: đi mùa nào.

  Nguồn là hashtag rõ nghĩa, cụm từ trong tiêu đề/nội dung, lộ trình và khách sạn gắn bài, và từ commit này thêm **caption qua embedding**. Bài không có tín hiệu rõ thì không vào ngăn nào. File: `domain/topics.ts`, `domain/bins.ts`.
- **Câu trả lời của người dùng.** Người dùng được mô tả bằng câu trả lời cho các câu hỏi đó, chia 5 giai đoạn: mơ, lên kế hoạch, sắp đi, đang đi, vừa về.
  - Lấy từ lượt xem, thả tim, lưu, tìm kiếm (gộp tìm lặp, mỗi nơi tối đa 1 lần/giờ), tìm phòng và đơn đặt.
  - Xem reels ≥ 80% thì được cộng điểm, bấm đặt từ reels thì tính là "đang tìm hiểu".
  - File: `domain/builders/trip-profile.ts`, `domain/live-answers.ts`.
- **Ranker `trip_v1`.**
  - Đọc toàn bộ bài, không chỉ bài thịnh hành.
  - Chấm cosine theo từng câu hỏi, trọng số đổi theo giai đoạn.
  - Lý do là câu trả lời ("Vì bạn đang tìm hiểu Nha Trang", "Cho chuyến Đà Lạt 12/11 của bạn"), không phải hashtag.
- **Đa dạng (feed-policy).**
  - Trong 5 bài liền nhau, tối đa 2 bài cùng nơi và 2 bài cùng ngăn trải nghiệm.
  - Nơi đang nhắm được tối đa 5/10 bài, không quá 4 bài liền nhau.
- **Consumer.** Nghe thêm `content.post.viewed` và `content.post.booking_clicked`. Hai sự kiện này đã được phát sẵn, chỉ thêm phía nghe.
- **Ngăn từ caption (commit cuối).**
  - Job nhúng tiêu đề + nội dung qua ai-service `POST /embed` (multilingual-e5-small INT8) và cache vector theo sha256 ở bảng mới `discovery.recommend_text_vectors`.
  - `bins.ts` so cosine với câu mô tả 9 ngăn và chỉ gán khi ngăn đầu hơn ngăn thứ hai ít nhất 0,0075 (Duy chọn sau khi quét biên theo F1).
  - AI tắt, lỗi hoặc dùng sai mô hình thì job bỏ nguồn caption và vẫn chạy.

## Đối chiếu "Xong khi"

| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Người đang lên kế hoạch thấy bài nơi mình nhắm | Có | `eval/report.md`: 4 persona lên kế hoạch đạt "đúng nơi@10" 0,50–0,80. v0 chỉ đạt 0,10–0,70 |
| Người vừa về không bị lặp nơi cũ | Có | `vua-ve-phuquoc`: v1 có 0 bài Phú Quốc trong top 10, v0 có 4 bài |
| Feed đa dạng ở giai đoạn mơ | Có | Persona "mơ": top 20 có 10–12 nơi (v0: 6–9), không quá 2 bài liền cùng nơi |
| Lý do dễ hiểu, không phải hashtag | Có | Cột "Lý do top 10" trong `eval/report.md` |
| Bài chỉ có caption vào được ngăn trải nghiệm | Có | Xem mục "Ngăn từ caption" bên dưới |

## Ngăn từ caption: đo ra sao

- **Caption thật.** Đo trên 283 caption công khai (133 YouTube Shorts + 150 TikTok). Nhãn là bản nháp, chỉ gắn khi chữ nói rõ; 49 caption không nói gì về trải nghiệm. Bản ONNX INT8 chạy thật ở ai-service, đã bỏ hashtag. Quét biên, FP gồm cả caption không nói gì mà bị gán:

  | Biên | precision | recall | F1 | gán bừa caption không nói gì |
  |---|---|---|---|---|
  | 0,0025 (F1 cao nhất) | 0,74 | 0,76 | 0,75 | 59% |
  | **0,0075 (đang dùng)** | 0,86 | 0,61 | **0,71** | 14% |
  | 0,02 (bản trước) | 0,97 | 0,35 | 0,52 | 2% |

- **Vì sao không dùng mô hình lớn hơn.** e5-large đúng hơn nhưng quá nặng cho máy chủ 2 vCPU / 8 GB dùng chung. Qwen3 và bge-m3 gán bừa nhiều hơn ở cùng độ phủ.
- **Chọn 0,0075 thay vì 0,0025.** F1 chỉ thấp hơn 0,04, nhưng tỉ lệ gán bừa giảm từ 59% xuống 14%. Ở 0,0025, caption thêm ngăn cho 104/243 bài mẫu và nhiều ngăn sai rõ, ví dụ "Vĩnh Long: miệt vườn, chợ nổi" bị gán `ve_dem`.
- **Trên 243 bài mẫu của DB local, biên 0,0075.**
  - Caption thêm ngăn cho 47 bài, trong đó 5/30 bài trước đó không có ngăn trải nghiệm nào.
  - Đúng: Tràng An, Ninh Bình vào `nui`; Côn Đảo, Bình Ba, Vũng Tàu vào `bien`; "Nhà hàng Vua Tôm Hùm" vào `an_uong`; "The Dog Bar" vào `ve_dem`.
  - Sai: "Săn mây Đà Lạt…" bị gán `cafe`; "Vịnh Hạ Long từ trên du thuyền" bị gán `nui`.
  - 28 lần gán `cafe`, phần lớn rơi vào caption seed theo mẫu có chữ "chill" ("Tối ở X, ăn no rồi ngồi viết cap").
  - Biên chỉ là một hằng số (`CAPTION_MARGIN` trong `bins.ts`). Đổi biên thì lượt job sau tự áp.

## Kết quả kiểm tra

Đã chạy sau khi `git merge origin/develop` ngày 19/11:

```
pnpm turbo run lint typecheck test --affected → 49/49 task thành công
core-api: 157 file test pass (2 bỏ qua), 2870 test pass (4 bỏ qua)
pnpm test:int (core-api) → 28 file, 236 test pass (Postgres thật, gồm migration mới)
```

Test mới:
- `bins.spec.ts`: nguồn caption, biên, cộng với nguồn khác, `textsToEmbed`.
- `build-features.use-cases.spec.ts`: cache thiếu/đủ, sai mô hình, AI lỗi, không cấu hình AI.
- `ai-embedding.client.spec.ts`: HTTP thật; chia lô 64, làm mới token khi gặp 401, lỗi thì trả null.
- `drizzle-recommend.store.int.spec.ts`: cache theo (mô hình, sha256) trên Postgres thật.

## Cách kiểm lại

1. `pnpm --filter @tripflix/core-api exec vitest run src/modules/discovery/recommend`
2. Bật v1 trên DB local:
   ```sql
   update discovery.recommend_algos set post_builder='post_profile@v1', user_builder='trip_profile@v1', ranker='trip_v1' where name='for_you';
   ```
   Quay lại v0: `post_builder='hot@v2', user_builder='tag_affinity@v0', ranker='tag_affinity_v0'`.
3. Ngăn từ caption cần ai-service có `/embed` (PR tripflix-ai `duy/TF28-embed-caption`), cùng `AI_SERVICE_URL` và `MODERATION_SERVICE_CLIENT_SECRET` của core. Thiếu các biến này thì job chỉ xếp ngăn bằng tag như trước.

## Ảnh / video

- Không đổi giao diện. Endpoint và JSON giữ nguyên.

## Ảnh hưởng tới phần của người khác

- Chỉ sửa trong `discovery` (Duy).
- Thêm một bảng và một migration của discovery.
- `AiEmbeddingClient` chép phần xin service token từ `content/moderation/infra/ai-moderation.client.ts` (của Trang), không import chéo module và không sửa file đó.
- Dùng lại biến môi trường có sẵn: `AI_SERVICE_URL`, `CORE_API_INTERNAL_URL`, `MODERATION_SERVICE_CLIENT_SECRET`.
- Phụ thuộc endpoint mới `/embed` ở tripflix-ai (Bảo review). Endpoint chưa có thì job vẫn chạy như trước.
