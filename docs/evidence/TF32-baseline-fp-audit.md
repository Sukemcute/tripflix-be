# TF32 — Giảm gắn cờ nhầm từ cảm thán

Ngày 11/11/2026. Nhánh `trang/TF32-profanity-false-positives`, tạo từ origin/develop tại c766deb. Phần content/moderation thuộc Trang. Thực hiện theo yêu cầu phân tích và giảm bắt nhầm của người dùng sau lượt eval ViSoBERT.

## Kết luận từ 19 trường hợp

- 6 câu chỉ do OpenAI, 11 câu chỉ do rule Core, 2 câu do cả hai.
- Với aiThreshold=0,8, reportThreshold=3 và reportCount=0, cả 19 câu tạo tín hiệu nghi vấn. Chạy evaluateSeverity thực tế xác nhận 0 câu trong nhóm này bị auto-hide.
- 9 câu khen có từ tục, 1 câu tục đứng riêng, 6 câu thuật lại/phản đối, 2 câu tiếng lóng và 1 câu cảnh báo an toàn.
- Core gắn cờ 13 câu, OpenAI gắn cờ 8 câu, giao nhau 2 câu.

## Thay đổi

Bỏ vcl/vkl/vcc/clgt khỏi nhánh token đơn của PROFANITY_PATTERN để phù hợp quy ước cho phép cảm thán. Các cụm công kích rõ nghĩa và các từ chửi trực tiếp dm/dmm/dcm/dkm/cmm vẫn được kiểm tra. Các mẫu như “vcl ad óc chó” tiếp tục khớp cụm “óc chó”.

Cập nhật hai kỳ vọng cũ cho “VKL, dịch vụ gì mà thế” và “clgt vậy trời” sang nhóm clean theo chính sách đã chốt. Bổ sung hồi quy cho cảm thán đứng riêng, khen dịch vụ và công kích có kèm từ cảm thán. Chữ ký hàm và schema RuleHit vẫn tương thích với caller.

Đã thử bỏ toàn bộ token viết tắt trong mô phỏng. Phương án đó làm mất tín hiệu rule cho các câu như “đm mày” hoặc “dcm chủ homestay”, nên bản sửa chỉ bỏ bốn token cảm thán.

## Kết quả trên dữ liệu đã xem

| Phương án trên 300 câu đã duyệt   |  TP |  FP | Recall tổng |    FPR |     F1 |
| --------------------------------- | --: | --: | ----------: | -----: | -----: |
| OpenAI + Core cũ                  | 118 |  19 |      78,67% | 12,67% | 82,23% |
| OpenAI + Core mới                 | 118 |  10 |      78,67% |  6,67% | 84,89% |
| Core mới + OpenAI + ViSoBERT 0,97 | 125 |  13 |      83,33% |  8,67% | 86,81% |

Bản sửa giảm 9 lần đưa câu sạch vào hàng chờ của baseline trên bộ 300 câu. Số bắt đúng 118 được giữ nguyên. Khi ghép ViSoBERT bằng OR, có một câu trước đó do Core bắt đã chuyển thành ViSoBERT bắt, nên tổng FP giảm từ 21 xuống 13. So với baseline mới, ViSoBERT bắt thêm 7 câu vi phạm và gắn cờ thêm 3 câu sạch.

Đối chiếu bổ sung, OpenAI + Core trên dev 240 câu giữ TP 45/FP 3. Trên bộ 3k lịch sử giữ TP 851/FP 86. Riêng rules-only cũng giữ số TP ở cả ba bộ, gồm 12/12 trên test 300, 12/12 trên dev 240 và 204/204 trên 3k. Nhãn bộ 3k lịch sử chưa được duyệt toàn bộ.

## Chi tiết từng trường hợp

| ID                       | Nhóm                 | Câu                                                                                         | Nguồn cũ    | Rule cũ   | Còn nghi vấn sau sửa |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------------------- | ----------- | --------- | -------------------- |
| tf32-h1-slang-020        | quoted_report        | Mình báo cáo câu 'lũ đồng tính là thứ dơ bẩn' vì đó là lời kỳ thị, xin quản trị viên xử lý. | openai_only | —         | Có                   |
| tf32-h1-slang-016        | slang                | Mệt muốn chết sau buổi đạp xe nhưng ngủ một giấc là khỏe lại.                               | openai_only | —         | Có                   |
| tf32-h1-slang_praise-021 | slang_praise         | Đường trượt phao vui vkl, tụi mình chơi tới lúc đóng cửa.                                   | core_only   | PROFANITY | Không                |
| tf32-h1-slang_praise-024 | slang_praise         | Ông tài xế tìm quán ăn trưa chất vcl, vừa ngon vừa có chỗ đỗ.                               | core_only   | PROFANITY | Không                |
| tf32-h1-slang-012        | slang                | Bà điên này lên lịch ăn uống chuẩn ghê, cả nhóm được nhờ rồi 😂                             | openai_only | —         | Có                   |
| tf32-h1-slang_praise-014 | slang_praise         | Con đường xe đạp ven đầm xịn vcc, mặt đường phẳng dễ chạy.                                  | core_only   | PROFANITY | Không                |
| tf32-h1-slang-022        | quoted_report        | Tôi nghe người ở sảnh đòi đánh gãy chân hướng dẫn viên nên đã báo trực ban can thiệp.       | both        | THREAT    | Có                   |
| tf32-h1-safety-022       | safety               | Mình bị một người lạ kéo tay ở bến tàu, bảo vệ đã đến can thiệp.                            | openai_only | —         | Có                   |
| tf32-h1-slang-021        | quoted_report        | Một tài khoản nhắn 'tao sẽ đốt xe mày', tôi đã lưu bằng chứng và nhờ bảo vệ hỗ trợ.         | openai_only | —         | Có                   |
| tf32-h1-slang_praise-006 | slang_praise         | Vcl, phần cá nướng gói lá thơm thật, hai đứa ăn sạch.                                       | core_only   | PROFANITY | Không                |
| tf32-h1-slang_praise-010 | slang_praise         | Ông chỉ chỗ dựng lều đỉnh vcl, sáng mở cửa là thấy mây.                                     | core_only   | PROFANITY | Không                |
| tf32-h1-slang_praise-008 | slang_praise         | Nhạc acoustic tối thứ bảy cuốn vkl, ngồi nghe quên giờ về.                                  | core_only   | PROFANITY | Không                |
| tf32-h1-slang-025        | standalone_profanity | Vcl!                                                                                        | core_only   | PROFANITY | Không                |
| tf32-h1-slang_praise-017 | slang_praise         | Đm cảnh đom đóm tối qua đẹp quá, lần đầu mình thấy nhiều vậy.                               | core_only   | PROFANITY | Có                   |
| tf32-h1-neutral-005      | quoted_report        | Nghe có người cổ vũ ném đá vào khách trên thuyền, tôi đề nghị bảo vệ ngăn chặn.             | openai_only | —         | Có                   |
| tf32-h1-slang_praise-018 | slang_praise         | Cái võng cạnh suối nằm chill vcl, nghe nước chảy buồn ngủ luôn.                             | core_only   | PROFANITY | Không                |
| tf32-h1-neutral-002      | quoted_report        | Tôi yêu cầu xóa bình luận 'phụ nữ là lũ ngu dốt', vì không thể công kích giới tính như thế. | both        | PROFANITY | Có                   |
| tf32-h1-neutral-004      | quoted_report        | Tôi được nhắn câu 'mày ngu như chó' sau khi hỏi giá, mong quản trị viên xem xét.            | core_only   | PROFANITY | Có                   |
| tf32-h1-slang_praise-001 | slang_praise         | Bình minh trên đồi cỏ tím đỉnh vcl, đáng công dậy từ bốn giờ.                               | core_only   | PROFANITY | Không                |

## Những trường hợp còn lại

OpenAI vẫn gắn cờ 8 câu, gồm thuật lại lời xúc phạm/đe dọa, nói đùa, cảnh báo và thành ngữ. Hai câu Core bắt riêng còn lại là lời khen mở đầu bằng “Đm” và lời thuật lại có “mày ngu”. Việc thêm ngoại lệ cho dm hoặc trích dẫn cần đánh giá theo ngữ cảnh để tránh bỏ lọt công kích trực tiếp. Bản sửa hiện tại tập trung vào bốn token có tính cảm thán phổ biến.

## Kiểm tra

- Chạy evaluateRules/evaluateSeverity thực tế từ TypeScript bằng Node 24, đối chiếu với OpenAI cache đúng ID và nội dung.
- Test domain rules đạt 80 passed. Các mẫu cảm thán đã được bổ sung cùng mẫu công kích cần giữ.
- Prettier kiểm tra hai file code đạt.
- Lệnh `pnpm turbo run lint typecheck test --affected --output-logs=errors-only` đạt 49/49 tasks successful sau khi đồng bộ dependency đã khai báo bằng `pnpm install --frozen-lockfile`. Package/lockfile giữ nguyên.
- Core API đạt 2140 tests passed, 1 skipped; gồm 80 test domain rules. Lint và typecheck trong phạm vi affected đều pass.

## Giới hạn và triển khai

Các bộ dữ liệu này đã được dùng để phân tích và sửa luật. Các số trên là kiểm tra hồi quy của thay đổi. Hiệu quả trên bình luận mới cần được đo tiếp. Thay đổi đang ở nhánh local, cần review và triển khai qua quy trình PR. Các báo cáo/cấu hình Colab cũ giữ hash của rule snapshot cũ và được giữ làm lịch sử.

Bằng chứng theo từng ID và hash rule nằm trong TF32-baseline-fp-audit.json cùng thư mục.
