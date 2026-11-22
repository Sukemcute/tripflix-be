# TF31 — ai-service staging nhận OPENAI_REASONING_EFFORT

- Nhánh: `phong/TF31-luna-reasoning` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-18

## Đã làm
- Bảo đổi Controller của Tripi sang `gpt-5.6-luna` (eval 98,0% so với 91,0% của `gpt-5-nano`). Luna chỉ nhận `reasoning.effort` là `none`, `low`, `medium`, `high`, `xhigh`, `max`, không nhận `minimal` là mặc định trong code tripflix-ai. `compose.server.yaml` chưa chuyển biến này vào ai-service, nên đặt trong `.env.server` cũng không có tác dụng và mọi lượt gọi Controller lỗi 400.
- Thêm `OPENAI_REASONING_EFFORT: ${OPENAI_REASONING_EFFORT:-}` vào ai-service. Để trống thì `ChatSettings` (`env_ignore_empty=True`) dùng mặc định `minimal`, nên staging chưa đặt biến vẫn chạy như cũ. Model và giá vẫn đặt trong `.env.server`, mặc định trong compose giữ `gpt-5-nano`.
- PR #270 của Bảo đã thêm biến này cho `compose.yaml` (dev local) và merge trước khi kịp gộp dòng của server, nên tách ra nhánh này.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| ai-service staging nhận `OPENAI_REASONING_EFFORT` | Chưa | Sau khi sửa trên server: `printenv OPENAI_REASONING_EFFORT` trong ai-service ra `none` |
| Giá Luna đúng trang OpenAI | Đạt | developers.openai.com, trang model `gpt-5.6-luna`: 0,2 / 0,02 / 1,2 USD mỗi 1 triệu token (input, cached, output) |
| Không đặt biến thì không đổi hành vi | Đạt | Giá trị rỗng bị `env_ignore_empty` bỏ qua, dùng `minimal` như trước |

## Kết quả kiểm tra
- `docker compose -f deploy/compose.server.yaml --profile ai config --no-interpolate -q`: đạt.

## Cách kiểm lại
1. Server: `dc --profile ai exec -T ai-service printenv OPENAI_REASONING_EFFORT CHAT_CONTROLLER_MODEL` ra `none`, `gpt-5.6-luna`.
2. Hỏi Tripi một câu trên staging, log ai-service không có lỗi 400 từ OpenAI.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa `deploy/` (Phong), theo yêu cầu của Bảo (chủ tripflix-ai).
