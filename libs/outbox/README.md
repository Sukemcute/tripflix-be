# libs/outbox

Hàm tạo bảng `outbox` trong schema của từng module, và relay đọc outbox rồi XADD sang Redis Streams qua `@tripflix/event-bus` (docs/architecture/10 §3.3).

- Phụ trách: Dũng (backup Duy)
- Chưa làm. Khi làm thì thêm package.json theo khuôn của libs/config.
