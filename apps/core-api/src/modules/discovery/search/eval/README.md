# Bộ 50 câu tìm kiếm thử (TF13)

Dùng để đo mục tiêu PRD F4: **≥ 80% câu tìm kiếm đúng ý ngay lần đầu** (PRD §1 và §8: bộ 50 câu kiểu người trẻ, có từ lóng, không dấu, câu bẫy về nơi không tồn tại, câu ngoài phạm vi; cố định phân bố trước khi đo).

| File | Nội dung |
|---|---|
| `queries.json` | 50 câu, mỗi câu có nhóm, luồng (`stays` / `posts`), cách hiểu đúng (`expect`) và kiểu chấm (`judge`) |
| `check-queries.mjs` | Kiểm bộ câu với seed commerce: câu cần kết quả thì dữ liệu phải có đáp án, câu bẫy thì dữ liệu phải không có. Chạy lại mỗi khi seed commerce đổi |

```bash
node apps/core-api/src/modules/discovery/search/eval/check-queries.mjs
```

## Phân bố (cố định)

| Nhóm | Số câu | Ví dụ |
|---|---|---|
| `plain`: có dấu, rõ ràng | 8 | "khách sạn 5 sao ở Hà Nội" |
| `no_diacritics`: không dấu, viết tắt | 10 | "ks pq gan bien", "ks hcm 5 sao" |
| `slang`: tiếng lóng, trộn tiếng Anh, emoji | 10 | "resort sang chảnh xịn xò phú quốc", "chỗ chill view biển ở nha trang 🌊" |
| `budget_party`: ngân sách, số người, số đêm | 10 | "nhóm 6 đứa đi nha trang 2 đêm, tổng dưới 10 củ" |
| `trap`: nơi hoặc chỗ không tồn tại, ràng buộc không thể | 7 | "khách sạn ở bangkok", "resort 5 sao phú quốc dưới 300k" |
| `out_of_scope`: ngoài du lịch, vô nghĩa, có hại | 5 | "cách nấu phở bò", "cách làm giả căn cước để thuê phòng" |

Theo luồng: 44 câu `stays` (tìm chỗ ở trên app), 6 câu `posts` (tìm bài đăng).

**Luật cố định:** không sửa câu hay đáp án sau lần đo đầu tiên. Muốn thêm, bớt hay đổi thì tạo `version: 2` và báo kết quả hai bản riêng. Điểm của hai bản không cộng hay so trực tiếp với nhau.

## Cách hiểu đúng (`expect`)

| Trường | Nghĩa | Loại ràng buộc |
|---|---|---|
| `places` | Các `provinceSlug` chấp nhận được. Liệt kê rõ, không tự mở rộng theo cây: "Đà Lạt" chấp nhận `da-lat`, `lam-dong` | Cứng |
| `styles` | Loại chỗ ở chấp nhận được, theo trường `style` của commerce (`biển`, `núi`, `homestay`, `boutique`, `resort`, `thành phố`) | Cứng |
| `minStars` | Hạng sao tối thiểu | Cứng |
| `brand` | Thương hiệu được hỏi đích danh | Cứng |
| `guests`, `nights` | Số khách (mặc định 2), số đêm (mặc định 1). "cuối tuần" là 1 đêm | Cứng: phải đủ chỗ |
| `singleRoom` | Cả nhóm ở chung một phòng hay căn | Cứng |
| `budget` | `{ max, per }`. `per: night` là giá một đêm một phòng; `group` là tổng cả kỳ, mọi phòng; `person` là tổng chia số khách. "tầm X" cho phép tới X × 1,1; "2 củ" là 2.000.000đ; "1tr5" là 1.500.000đ | **Cứng: không bao giờ vượt** |
| `intents` | Ý muốn mềm: `sea_view`, `quiet`, `party`, `luxury`, `cheap`, `family`, `photo`, `central`, `nature`, `pool`, `food` | Mềm, người chấm |
| `unknownPlace` | Nơi không có trong dữ liệu | Dùng cho câu bẫy |

## Cách chấm "kết quả đầu đúng ý"

Mỗi câu chỉ xét **kết quả đầu tiên** (top-1) của lần tìm đầu, không cho người dùng sửa bộ lọc.

Tham số đo cố định cho luồng `stays`:
- `checkIn` = ngày đo + 14 ngày.
- `checkOut` = `checkIn` + `nights` (mặc định 1).
- `adults` = `guests` (mặc định 2).
- Dữ liệu là seed commerce mới, chưa ai sửa lịch.

| `judge` | Đúng khi | Sai khi |
|---|---|---|
| `top1` | Kết quả đầu thoả **mọi ràng buộc cứng** trong `expect` với tham số đo ở trên, và nếu có `intents` thì **cả hai người chấm** đồng ý nó hợp ít nhất một ý trong đó | Rỗng (dữ liệu có đáp án, `check-queries.mjs` đã kiểm); sai nơi, sai loại, thiếu sao; không đủ chỗ; vượt ngân sách dù chỉ 1đ; người chấm cho là lạc ý |
| `empty` | Không trả kết quả nào, hoặc chỉ trả thông báo không tìm thấy hay câu hỏi lại | Trả bất kỳ kết quả nào: dữ liệu không có chỗ thoả, nên mọi kết quả đều sai một ràng buộc |
| `refuse` | Không trả chỗ ở hay bài đăng, và (trên app) có câu từ chối lịch sự đúng giọng | Trả kết quả du lịch, hoặc làm theo yêu cầu có hại |

**Người chấm:** hai người chấm độc lập phần `intents` và phần câu từ chối, không xem điểm của nhau. Hai người lệch nhau thì người thứ ba quyết. Ghi tỉ lệ đồng ý giữa hai người vào báo cáo.

**Bảng gợi ý để chấm `intents`:** chỉ để tham khảo, người chấm vẫn quyết theo tên, ảnh, mô tả.
- `sea_view`, `pool`: style `biển` hoặc `resort`, hay tên có "Beach", "Resort".
- `quiet`, `nature`: `núi`, `homestay`, `resort`; không phải khách sạn trung tâm.
- `central`: `thành phố`, `boutique` ở khu trung tâm hay phố cổ.
- `luxury`: 5 sao hoặc thương hiệu cao cấp.
- `cheap`: thuộc 1/3 rẻ nhất của nơi đó cho tham số đo.
- `family`: phòng ≥ 4 khách hoặc `resort`.

## Điểm

- **Điểm chính** = số câu đúng / 50. Mục tiêu PRD: **≥ 40/50 (80%)**.
- Báo cáo thêm điểm theo từng nhóm và theo luồng.
- Câu `posts` chỉ chấm được khi content có bài mẫu. Trước đó, báo cáo riêng điểm trên 44 câu `stays` và ghi rõ là chưa đủ 50.
- Mỗi lần đo ghi lại: commit đã đo, ngày đo, tham số, kết quả top-1 của từng câu (id, tên, giá), điểm từng người chấm.
