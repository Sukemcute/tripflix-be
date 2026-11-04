<!-- Tiêu đề: <type>(<scope>): <mô tả> (TFxx). PR vào develop từ nhánh <tên>/<TFxx>-<mô-tả>. Xem RULES.md mục 7. -->

## Task
- Notion:
- Evidence: `docs/evidence/<TFxx>-<mô-tả>.md`

## Đã làm
-

## Kiểm tra
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass (kết quả trong file evidence)
- [ ] Đủ tiêu chí "Xong khi" của task
- [ ] Đổi API/sự kiện: chỉ thêm trường, đã chạy `pnpm contracts:build` và commit `contracts/`
- [ ] Có migration: tạo mới, không sửa migration cũ

## Ảnh hưởng tới phần của người khác
- [ ] Không
- [ ] Có (file, chủ code, đã báo và được đồng ý):
