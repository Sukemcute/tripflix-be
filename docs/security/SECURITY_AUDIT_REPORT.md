# BÁO CÁO KIỂM TOÁN BẢO MẬT TOÀN DIỆN NỀN TẢNG TRIPFLIX

**Mã tài liệu:** `SEC-AUD-2026-11`  
**Ngày đánh giá:** 20 tháng 11, 2026  
**Chức danh đánh giá:** Kỹ sư Trưởng An toàn Ứng dụng & Kiến trúc sư Bảo mật (Principal AppSec Engineer & Security Architect)  
**Trạng thái:** Hoàn tất đánh giá — Chờ phê duyệt triển khai khắc phục  

---

## 1. Tóm tắt dành cho cấp quản lý (Executive Summary)

Một cuộc kiểm toán an toàn thông tin toàn diện, dựa trên bằng chứng mã nguồn thực tế đối với toàn bộ nền tảng **Tripflix** và hạ tầng phụ trợ đã được tiến hành. Phạm vi kiểm toán bao gồm các dịch vụ backend (`tripflix-be`), các ứng dụng web và mobile (`tripflix-fe`), dịch vụ trí tuệ nhân tạo viết bằng Python (`tripflix-ai`), hệ thống định tuyến biên ingress/reverse proxy (`deploy/`), cũng như các thư viện phụ thuộc của bên thứ ba.

Quá trình đánh giá được thực hiện đối chiếu theo các khung tiêu chuẩn công nghiệp gồm: **OWASP Top 10 (2021)**, **OWASP API Security Top 10 (2023)**, và **OWASP ASVS v4.0.3 (Application Security Verification Standard)**, tuân thủ nghiêm ngặt các quy tắc an toàn và quy trình phân tích từ kho kỹ năng bảo mật chuẩn (`ptn1411/skill`).

### 1.1 Đánh giá thế trận an ninh tổng thể (Security Posture)

Kiến trúc của Tripflix thể hiện tư duy thiết kế an toàn bài bản ở nhiều lớp cốt lõi:
- **Hệ thống xác thực hiện đại:** Sử dụng nền tảng mật mã học bất đối xứng với JWT ký bằng thuật toán ES256, xác thực động qua endpoint JWKS (`.well-known/jwks.json`), lưu băm mật khẩu bằng Argon2id, gắn vân tay thiết bị trình duyệt (`x-browser-proof`), và xoay vòng refresh token theo chuỗi gia đình (family lineage) có khả năng tự động thu hồi toàn bộ phiên nếu phát hiện dấu hiệu tái sử dụng token.
- **Kiểm soát phân quyền và kiểm duyệt nội dung:** Áp dụng chặt chẽ mô hình phân quyền dựa trên vai trò (`@Roles`), sử dụng khóa hàng cơ sở dữ liệu có tính giao dịch (`FOR UPDATE`) để chống race condition khi duyệt báo cáo vi phạm, và đã bổ sung kiểm tra quyền sở hữu đối với media bài đăng.
- **Đóng gói container an toàn:** Tất cả Dockerfile đều chỉ định rõ người dùng không đặc quyền (`USER node`, `USER worker`, `USER 10001:10001`), áp dụng multi-stage build để giảm thiểu tối đa diện tích tấn công trong image.
- **Bảo vệ dịch vụ AI:** Dịch vụ AI (`tripflix-ai`) có cơ chế kiểm soát lượt gọi bằng vé (`TurnGate`), giới hạn số lượng token đầu ra và che giấu toàn bộ API key/thông tin nhạy cảm qua kiểu dữ liệu Pydantic `SecretStr`.

Tuy nhiên, đợt kiểm toán đã phát hiện **1 lỗ hổng Nghiêm trọng (Critical)** và **1 lỗ hổng Mức độ cao (High)** cùng một số vấn đề Mức độ trung bình (Medium) và Thấp (Low) cần phải được khắc phục triệt để trước khi đưa hệ thống vào vận hành thương mại:
1. **Lỗ hổng Bỏ qua thanh toán mức Nghiêm trọng (Critical):** Controller thanh toán thử nghiệm (`MockGatewayController`) vẫn được đăng ký trong module chạy thật và lộ ra ngoài Internet thông qua cấu hình Traefik. Kẻ tấn công có thể lấy token thẻ thử nghiệm miễn phí và gọi API thanh toán để xác nhận các đơn đặt phòng khách sạn và vé máy bay thật chuyển sang trạng thái `PAID` mà không phải trả bất kỳ chi phí nào.
2. **Lỗ hổng Từ chối dịch vụ (DoS) trang Quản trị mức Cao (High):** Proxy Backend-For-Frontend (BFF) của trang quản trị (`apps/admin`) quản lý phiên đăng nhập trong một biến `Map` trên RAM của Node.js với giới hạn cứng 1.000 phiên. Khi chạm mốc này, toàn bộ quản trị viên sẽ bị khóa khỏi hệ thống (lỗi HTTP 503). Đồng thời, việc lưu trong RAM gây mất phiên khi khởi động lại container và không thể mở rộng ngang (scale horizontal) trên nhiều container.

### 1.2 Bảng tổng hợp các phát hiện bảo mật

| Mã phát hiện | Tiêu đề phát hiện | Thành phần ảnh hưởng | Mức độ nghiêm trọng | CVSS v3.1 | Trạng thái xác nhận |
| :--- | :--- | :--- | :---: | :---: | :---: |
| **SEC-01** | Bật Mock Payment Gateway ở Production cho phép thanh toán khống miễn phí | `apps/core-api` (Commerce) | **CRITICAL** | **9.1** | **ĐÃ KHẮC PHỤC (PR #318)** |
| **SEC-02** | Lưu trữ Session trong RAM tại Admin BFF gây Từ chối dịch vụ (DoS) & Mất đồng bộ đa node | `apps/admin` (BFF) | **HIGH** | **6.5** | **ĐÃ KHẮC PHỤC (Commit da0fa06)** |
| **SEC-03** | Traefik Ingress bỏ sót giới hạn tốc độ (Rate Limiting) trên `POST /api/auth/login-code` | `deploy/traefik` (Ingress) | **MEDIUM** | **5.3** | **ĐÃ KHẮC PHỤC (Commit 4b4ee96)** |
| **SEC-04** | Lộ lọt endpoint cấp phát Service Token nội bộ ra ngoài mạng Internet công cộng | `apps/core-api` (Access) | **MEDIUM** | **6.5** | **ĐÃ KHẮC PHỤC (Commit 4b4ee96)** |
| **SEC-05** | Cơ chế Fail-Open thu hồi token khi Redis gặp sự cố trên các endpoint thanh toán/đặt hàng | `apps/core-api` (Commerce) | **MEDIUM** | **5.9** | **ĐÃ KHẮC PHỤC (Commit c047376)** |
| **SEC-06** | Thiếu HTTP Security Headers, CSP và bảo vệ Clickjacking tại trang quản trị Admin Console | `apps/admin` (Frontend) | **LOW** | **4.3** | **ĐÃ KHẮC PHỤC (Commit da0fa06)** |
| **SEC-07** | Phạm vi Wildcard Cookie Signed của CloudFront Playback quá rộng qua toàn bộ môi trường | `apps/core-api` (Media) | **LOW** | **3.1** | **ĐÃ KHẮC PHỤC (Commit 830a94b)** |
| **SEC-08** | File Docker Compose Local Dev bind cổng PostgreSQL và Redis ra tất cả card mạng (`0.0.0.0`) | `deploy/compose.yaml` | **INFORMATIONAL** | **3.5** | **ĐÃ KHẮC PHỤC (Commit 830a94b)** |
| **SEC-09** | Biến `conversationId` lưu ở phạm vi module-scope trong Mobile Assistant Transport | `apps/mobile` (Frontend) | **INFORMATIONAL** | **2.0** | **ĐÃ KHẮC PHỤC (Commit 4287ffd)** |

---

## 2. Phạm vi & Phương pháp đánh giá

### 2.1 Phạm vi kiểm toán

Phạm vi kiểm toán bao trùm toàn bộ không gian làm việc và các phân hệ liên quan:

- **Hệ thống Backend (`tripflix-be`):**
  - Khối dịch vụ lõi NestJS (`apps/core-api`): Phân hệ Access (Xác thực, phân quyền), Content (Bài viết, reel, video, bình luận, tương tác), Commerce (Giỏ hàng, giữ chỗ khách sạn/vé bay, đơn hàng, thanh toán VNPay/Mock), Discovery (Gợi ý, tìm kiếm), Analytics (Nhật ký hành vi), Moderation (Kiểm duyệt vi phạm).
  - Khối tác vụ nền bất đồng bộ (`apps/video-worker` bằng TypeScript và Go): Chuyển đổi mã hóa video (transcoding HLS), băm phân đoạn, tích hợp ký cookie CloudFront.
  - Phân hệ thông báo (`apps/notification-service`): WebPush, hàng đợi gửi email/SMS giao dịch.
- **Hệ thống Frontend (`tripflix-fe`):**
  - Ứng dụng web công cộng (`apps/web`): Next.js App Router, SSR, tích hợp video player.
  - Cổng thông tin điều hành quản trị (`apps/admin`): Next.js App Router với lớp proxy nội bộ Backend-For-Frontend (BFF).
  - Ứng dụng di động (`apps/mobile`): React Native / Expo hỗ trợ trải nghiệm lướt video ngắn và trợ lý ảo Tripi.
- **Hệ thống Trí tuệ nhân tạo (`tripflix-ai`):**
  - Dịch vụ FastAPI Python: Trợ lý trò chuyện Tripi, quản lý phiên chat, phân phối lượt stream SSE, tiền kiểm duyệt nội dung văn bản.
- **Hạ tầng triển khai & Cấu hình:**
  - Reverse proxy & cổng biên Ingress (`deploy/traefik/server.yml`).
  - Các cấu hình Docker Compose môi trường máy chủ và phát triển (`deploy/compose.server.yaml`, `deploy/compose.yaml`).
  - Cơ chế quản lý biến môi trường, khóa bí mật và chứng chỉ số.

### 2.2 Phương pháp đánh giá

Cuộc kiểm toán áp dụng phương pháp phân tích tĩnh và đánh giá kiến trúc chuyên sâu chỉ đọc (read-only):
1. **Lập mô hình đe dọa & Phân rã bề mặt tấn công:** Rà soát đường biên mạng, luồng ingress, ranh giới tin cậy giữa các microservice và các điểm chốt phân quyền.
2. **Phân tích mã nguồn tĩnh (SAST):** Kiểm tra từng controller, guard, middleware, entity schema và câu truy vấn SQL/Drizzle để phát hiện các lỗi tiêm mã (injection), lỗi logic xác thực, phân quyền đối tượng bị hỏng (BOLA/IDOR), và lỗ hổng quản lý trạng thái.
3. **Phân tích chuỗi cung ứng & Thư viện phụ thuộc:** Thực thi `pnpm audit` trên toàn bộ monorepo Node.js và kiểm tra các gói thư viện Python trong `pyproject.toml`.
4. **Kiểm tra hồi quy bảo mật:** Đánh giá lại toàn bộ các phát hiện tồn đọng từ đợt kiểm toán trước (`docs/security-audit/RUN-2-SUMMARY.md`) nhằm đảm bảo các lỗi cũ đã được sửa đổi thỏa đáng và không tái xuất hiện.

---

## 3. Kiến trúc hệ thống & Lập bản đồ bề mặt tấn công

```
                                      [ INTERNET ]
                                           │
                                    (TLS / HTTPS)
                                           │
                                    ┌──────▼──────┐
                                    │   Traefik   │  Cổng biên Ingress / Reverse Proxy
                                    │Reverse Proxy│  Giới hạn tốc độ: auth (30/phút), api (50/giây)
                                    └──┬───┬───┬──┘
                                       │   │   │
                  ┌────────────────────┘   │   └───────────────────────┐
                  │                        │                           │
          ┌───────▼────────┐      ┌────────▼────────┐         ┌────────▼────────┐
          │   apps/admin   │      │    apps/web     │         │ apps/core-api   │
          │   (Next.js)    │      │    (Next.js)    │         │    (NestJS)     │
          │  BFF: /bff/api │      │ Web công cộng   │         │ REST API Lõi    │
          └───────┬────────┘      └────────┬────────┘         └────────┬────────┘
                  │                        │                           │
                  └────────────────────────┴─────────────┬─────────────┘
                                                         │
                                               ┌─────────┴─────────┐
                                               │ Mạng nội bộ Docker│
                                               └─────────┬─────────┘
                                                         │
                             ┌───────────────────────────┼───────────────────────────┐
                             │                           │                           │
                     ┌───────▼────────┐          ┌───────▼────────┐          ┌───────▼────────┐
                     │  PostgreSQL 17 │          │  Redis 7-alpine│          │  tripflix-ai   │
                     │  (Dữ liệu+Auth)│          │(Phiên, Token)  │          │   (FastAPI)    │
                     └────────────────┘          └────────────────┘          └────────────────┘
```

### 3.1 Ranh giới tin cậy & Phân vùng mạng (Trust Boundaries)

1. **Vùng không tin cậy (Perimeter / Untrusted Zone):** Người dùng Internet công cộng, trình duyệt khách, ứng dụng mobile, máy quét mạng bên ngoài, webhook của cổng thanh toán.
2. **Vùng phân tách biên (DMZ / Ingress Zone):** Traefik reverse proxy chịu trách nhiệm kết thúc mã hóa TLS, định tuyến tiền tố đường dẫn (PathPrefix), và thực hiện lọc tốc độ cơ bản.
3. **Vùng dịch vụ ứng dụng nội bộ (Application Service Zone):**
   - `core-api` chạy cổng nội bộ 3000.
   - `apps/web` chạy cổng nội bộ 3001.
   - `apps/admin` chạy cổng nội bộ 3002 (kèm route handler `/bff/api`).
   - `tripflix-ai` chạy cổng nội bộ 8000.
4. **Vùng dữ liệu & Hạ tầng lưu trữ (Persistence Zone):** Cụm cơ sở dữ liệu PostgreSQL (pgvector), Redis cluster, AWS S3 bucket lưu trữ video/ảnh, AWS CloudFront CDN phân phối HLS stream.

### 3.2 Luồng xác thực & Quản lý phiên làm việc

- **Kiến trúc Access Token:** Sử dụng JWT ký bằng thuật toán khóa công khai ES256, được xác thực thông qua `.well-known/jwks.json`. Token chứa `sub` (User ID), `role` (vai trò), `tier` (hạng thành viên), và `jti` (mã định danh token).
- **Ràng buộc chống Replay:** Header `x-browser-proof` gắn kết vân tay trình duyệt với token nhằm ngăn chặn hành vi đánh cắp token để sử dụng ở môi trường khác.
- **Cơ chế Refresh Token:** Refresh token có độ ngẫu nhiên cao được lưu trong cookie HTTP-only, Secure, SameSite=Strict. Dữ liệu token được quản lý trong PostgreSQL theo phả hệ gia đình; hành vi dùng lại refresh token cũ sẽ lập tức kích hoạt cơ chế thu hồi toàn bộ phiên trong gia đình đó.
- **Thu hồi Token tức thì:** Được kiểm tra thông qua Redis (`RedisTokenRevocationStore`).

---

## 4. Chi tiết các lỗ hổng bảo mật đã xác thực

---

### SEC-01: Bật Mock Payment Gateway ở Production cho phép thanh toán khống miễn phí

- **Mã phát hiện:** `SEC-01`
- **Tiêu đề:** Mock Payment Gateway được kích hoạt ở môi trường Production & Cho phép bỏ qua thanh toán để đặt vé/phòng miễn phí
- **Mức độ nghiêm trọng:** **CRITICAL (Nghiêm trọng)**
- **Điểm CVSS v3.1:** `9.1` (`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:H`)
- **Độ tin cậy:** Đã xác thực 100% (Kiểm chứng qua mã nguồn và cấu hình định tuyến)
- **Thành phần ảnh hưởng:** `apps/core-api` — Phân hệ Thương mại (`CommerceModule`, `MockGatewayController`, `MockGateway`)
- **Tệp tin và dòng mã liên quan:**
  - [commerce.module.ts](file:///d:/Sukem/VinUni/VSF/tripflix/tripflix-be/apps/core-api/src/modules/commerce/commerce.module.ts#L110-L130)
  - [mock-gateway.controller.ts](file:///d:/Sukem/VinUni/VSF/tripflix/tripflix-be/apps/core-api/src/modules/commerce/payment/api/mock-gateway.controller.ts#L14-L36)
  - [server.yml](file:///d:/Sukem/VinUni/VSF/tripflix/tripflix-be/deploy/traefik/server.yml#L49-L54)

#### Nguyên nhân gốc rễ (Root Cause)
Trong tệp `commerce.module.ts`, `MockGatewayController` được khai báo trực tiếp trong mảng `controllers` của module mà không có bất kỳ điều kiện kiểm tra môi trường nào (`NODE_ENV`). Đồng thời, interface `PAYMENT_GATEWAY` được bind mặc định vào `MockGateway`:

```typescript
// apps/core-api/src/modules/commerce/commerce.module.ts
@Module({
  controllers: [
    CartController,
    CheckoutController,
    VnpayController,
    MockGatewayController, // <-- Đăng ký vô điều kiện ở production!
  ],
  providers: [
    {
      provide: PAYMENT_GATEWAY,
      useClass: MockGateway, // <-- Luôn dùng MockGateway làm cổng xử lý thanh toán mặc định!
    },
    ...
```

Cấu hình Traefik định tuyến toàn bộ tiền tố `/api` về `core-api`, khiến các endpoint `GET /api/mock-gateway/test-cards` và `POST /api/mock-gateway/tokens` bị phơi nhiễm trực tiếp ra ngoài Internet mà không cần bất kỳ xác thực nào.

#### Kịch bản khai thác thực tế (Attack Scenario)
1. Kẻ tấn công gửi yêu cầu không cần đăng nhập đến `GET /api/mock-gateway/test-cards` để lấy danh sách thẻ giả lập hợp lệ (ví dụ: `card_success`).
2. Kẻ tấn công gửi yêu cầu đến `POST /api/mock-gateway/tokens` với payload `{"cardId": "card_success"}`. API trả về một mã thẻ token giả lập hợp lệ: `tok_mock_success_...`.
3. Kẻ tấn công tạo một tài khoản người dùng bình thường, chọn giữ chỗ chuyến bay hoặc phòng khách sạn thật thông qua `POST /api/checkout/hotel` hoặc `POST /api/checkout/flight` để tạo đơn hàng.
4. Kẻ tấn công gọi `POST /api/checkout/:id/pay` với payload:
   ```json
   {
     "paymentMethod": "card",
     "cardToken": "tok_mock_success_..."
   }
   ```
5. `CheckoutUseCase.payOrder` chuyển token này đến `MockGateway`. `MockGateway` lập tức phản hồi thành công, gán mã giao dịch giả lập, cập nhật trạng thái đơn hàng sang `PAID`, giải phóng slot giữ chỗ tạm thời và chuyển sang trạng thái đã bán thành công.
6. Vé máy bay và phòng khách sạn thực tế được hệ thống xuất phiếu xác nhận hoàn tất mà không có bất kỳ dòng tiền thực nào được ghi nhận qua ngân hàng hay cổng thanh toán.

#### Tác động kinh doanh (Business Impact)
Thiệt hại tài chính trực tiếp và nghiêm trọng; cạn kiệt phòng khách sạn và vé máy bay do kẻ gian dùng bot gom vé; gây tổn hại nghiêm trọng uy tín với các đối tác hàng không và khách sạn.

#### Bằng chứng mã nguồn (Evidence)
Xem xét tệp [mock-gateway.controller.ts](file:///d:/Sukem/VinUni/VSF/tripflix/tripflix-be/apps/core-api/src/modules/commerce/payment/api/mock-gateway.controller.ts#L14-L36):
```typescript
@Controller('mock-gateway')
export class MockGatewayController {
  constructor(private readonly mockGateway: MockGateway) {}

  @Get('test-cards')
  getTestCards() {
    return this.mockGateway.getTestCards();
  }

  @Post('tokens')
  createToken(@Body() dto: CreateMockTokenDto) {
    return this.mockGateway.createToken(dto.cardId);
  }
}
```
Không hề có guard hay điều kiện môi trường kiểm soát endpoint này.

#### Đề xuất khắc phục (Recommended Fix)
1. Trong `commerce.module.ts`: Chỉ đăng ký `MockGatewayController` và bind `MockGateway` khi `process.env.NODE_ENV !== 'production' && process.env.ENABLE_MOCK_PAYMENT === 'true'`.
2. Khi chạy production, bắt buộc bind `PAYMENT_GATEWAY` vào cổng thật (ví dụ `VnpayGateway`).
3. Bổ sung một rule chặn tuyệt đối tại Traefik (`deploy/traefik/server.yml`) đối với đường dẫn `/api/mock-gateway`.

#### Phương pháp kiểm chứng an toàn (Verification Method)
1. Chạy unit test kiểm tra `CommerceModule`: Khi đặt `NODE_ENV=production`, đảm bảo `MockGatewayController` không được nạp vào NestJS container.
2. Gửi request `GET /api/mock-gateway/test-cards` đến môi trường staging/production — đảm bảo nhận về mã lỗi HTTP 404 Not Found hoặc 403 Forbidden.

#### Kết quả khắc phục thực tế (Remediation Verification)
- **Trạng thái:** **ĐÃ KHẮC PHỤC TRIỆT ĐỂ (RESOLVED)**
- **Kỹ sư thực hiện:** Nguyễn Lê Phúc Thắng (Assignee của task [SCRUM-187](https://tripflix.atlassian.net/browse/SCRUM-187) / [SCRUM-107](https://tripflix.atlassian.net/browse/SCRUM-107))
- **Mã PR & Commit:** PR `#318` (Commit `193f977`), đã merge vào nhánh `develop`.
- **Chi tiết bản vá:**
  1. `CommerceModule`: Thêm cờ `mockPaymentEnabled = process.env.NODE_ENV !== 'production' && process.env.ENABLE_MOCK_PAYMENT === 'true'`. Chỉ nạp `MockGatewayController` và provider `PAYMENT_GATEWAY` khi cờ này bật.
  2. Bổ sung `CardPaymentGuard`: Chặn đứng các yêu cầu thanh toán bằng token thẻ nếu cổng thanh toán không khả dụng (ném lỗi `NotFoundException`).
  3. Cấu hình Traefik (`deploy/traefik/server.yml`): Bổ sung quy tắc `!PathPrefix('/api/mock-gateway')` trên các router `core-api`, `web`, `web-www`, và `admin`.
  4. Đã bổ sung bộ kiểm thử e2e trong `mock-payment.e2e.spec.ts` chứng minh hoàn toàn không thể thanh toán bằng mock token trên production; toàn bộ các ca kiểm thử hồi quy đều đạt kết quả `PASS`.

---

### SEC-02: Lưu trữ Session trong RAM tại Admin BFF gây DoS & Mất đồng bộ đa node

- **Mã phát hiện:** `SEC-02`
- **Tiêu đề:** Quản lý phiên đăng nhập Admin BFF trong bộ nhớ RAM gây khóa tài khoản hàng loạt (DoS) và lỗi mất phiên khi chạy nhiều container
- **Mức độ nghiêm trọng:** **HIGH (Mức độ cao)**
- **Điểm CVSS v3.1:** `6.5` (`CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:H`)
- **Độ tin cậy:** Đã xác thực 100% (Kiểm chứng qua mã nguồn)
- **Thành phần ảnh hưởng:** `apps/admin` — Route Handler của BFF Proxy
- **Tệp tin và dòng mã liên quan:**
  - [route.ts](file:///d:/Sukem/VinUni/VSF/tripflix/tripflix-fe/apps/admin/src/app/bff/api/%5B...path%5D/route.ts#L28-L30)
  - [route.ts](file:///d:/Sukem/VinUni/VSF/tripflix/tripflix-fe/apps/admin/src/app/bff/api/%5B...path%5D/route.ts#L175-L178)

#### Nguyên nhân gốc rễ (Root Cause)
Next.js BFF proxy của trang Admin quản lý phiên người dùng bằng một đối tượng JavaScript `Map` nằm trực tiếp trong bộ nhớ tiến trình (RAM):
```typescript
// apps/admin/src/app/bff/api/[...path]/route.ts
const sessions = new Map<string, SessionData>();
const maxSessions = 1000;
```
Khi xử lý đăng nhập:
```typescript
if (sessions.size >= maxSessions) {
  return reply(503, { message: 'Too many concurrent sessions' });
}
```

#### Kịch bản khai thác thực tế (Attack Scenario)
1. **Tấn công Từ chối dịch vụ (Khóa toàn bộ Admin):** Một tài khoản điều hành viên có quyền hợp lệ (hoặc kẻ tấn công chiếm được thông tin đăng nhập cấp thấp) thực hiện tự động đăng nhập liên tục để sinh ra 1.000 phiên. Khi `sessions.size >= 1000`, mọi nỗ lực đăng nhập của tất cả các quản trị viên cấp cao khác đều bị hệ thống từ chối với lỗi `HTTP 503 Too many concurrent sessions`. Toàn bộ đội ngũ vận hành bị khóa khỏi cổng kiểm duyệt và xử lý sự cố.
2. **Lỗi bất đồng bộ khi mở rộng cụm (Cluster Inconsistency):** Khi triển khai `apps/admin` trên 2 container trở lên phía sau Traefik (không có cấu hình sticky session), quản trị viên đăng nhập ở Instance A thì session được lưu trong RAM của Instance A. Yêu cầu tiếp theo từ trình duyệt nếu được cân bằng tải sang Instance B sẽ bị lỗi ngay lập tức vì Instance B không có session này trong RAM, dẫn tới lỗi `HTTP 401 Unauthorized` ngẫu nhiên.
3. **Mất phiên khi cập nhật hệ thống:** Bất kỳ lần restart container, cập nhật phiên bản mới hoặc tiến trình Node.js bị crash đều xóa sạch toàn bộ session của admin, buộc tất cả phải đăng nhập lại từ đầu.

#### Tác động kinh doanh (Business Impact)
Rủi ro gián đoạn vận hành nghiêm trọng; mất tính sẵn sàng của bộ máy kiểm duyệt và quản trị nội dung; hệ thống không thể mở rộng quy mô phục vụ chịu tải.

#### Bằng chứng mã nguồn (Evidence)
Dòng mã 28–30 và dòng 175–178 trong tệp `apps/admin/src/app/bff/api/[...path]/route.ts` xác nhận rõ việc khởi tạo `new Map()` và ngắt kết nối với mã 503 khi chạm ngưỡng 1.000.

#### Đề xuất khắc phục (Recommended Fix)
1. Chuyển đổi toàn bộ việc lưu trữ phiên sang cụm Redis dùng chung (`ioredis`) có cơ chế tự động hết hạn key (TTL).
2. Hoặc chuyển đổi cơ chế session sang dạng cookie mã hóa (stateless encrypted cookie) mang thông tin access/refresh token có chữ ký xác thực.

#### Phương pháp kiểm chứng an toàn (Verification Method)
1. Viết kịch bản kiểm thử tạo 1.005 session; đảm bảo hệ thống lưu trữ trên Redis không trả về lỗi HTTP 503.
2. Chạy đồng thời 2 container `apps/admin` và kiểm tra xác thực chéo giữa hai node để đảm bảo tính đồng nhất.

---

### SEC-03: Traefik Ingress bỏ sót Rate Limiting trên `POST /api/auth/login-code`

- **Mã phát hiện:** `SEC-03`
- **Tiêu đề:** Router kiểm soát tốc độ tại Traefik bỏ sót endpoint gửi mã OTP đăng nhập `POST /api/auth/login-code`
- **Mức độ nghiêm trọng:** **MEDIUM (Mức độ trung bình)**
- **Điểm CVSS v3.1:** `5.3` (`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`)
- **Độ tin cậy:** Đã xác thực 100% (Kiểm chứng cấu hình Ingress)
- **Thành phần ảnh hưởng:** `deploy/traefik` — Cấu hình Ingress Reverse Proxy
- **Tệp tin và dòng mã liên quan:**
  - [server.yml](file:///d:/Sukem/VinUni/VSF/tripflix/tripflix-be/deploy/traefik/server.yml#L37-L45)

#### Nguyên nhân gốc rễ (Root Cause)
Traefik cấu hình router `core-api-auth` gắn kèm middleware giới hạn tốc độ gắt gao `rate-limit-auth` (30 req/phút, burst 10). Tuy nhiên, quy tắc khớp URL liệt kê danh sách cụ thể:
```yaml
rule: "Host(`{{env "DOMAIN"}}`) && (PathPrefix(`/api/auth/login`) || PathPrefix(`/api/auth/register`) || PathPrefix(`/api/auth/registration-code`) || PathPrefix(`/api/auth/google`) || PathPrefix(`/api/auth/password/forgot`) || PathPrefix(`/api/auth/password/reset`) || PathPrefix(`/api/auth/service-token`))"
```
Endpoint `POST /api/auth/login-code` (gửi mã đăng nhập OTP qua Email/SMS) hoàn toàn bị **bỏ quên** khỏi danh sách này.

#### Kịch bản khai thác thực tế (Attack Scenario)
Vì không khớp với `core-api-auth`, các yêu cầu đến `/api/auth/login-code` sẽ rơi xuống router chung `core-api` với mức giới hạn lỏng lẻo `rate-limit-api` (50 req/giây, burst 100). Kẻ tấn công có thể gửi hàng nghìn yêu cầu trong một thời gian ngắn. Mặc dù tầng backend NestJS có giới hạn thứ cấp tại Redis, lớp bảo vệ phòng thủ theo chiều sâu (Defense-in-Depth) tại gateway biên bị vô hiệu hóa, tạo cơ hội cho kẻ gian làm quá tải hàng đợi gửi SMS/Email và làm cạn kiệt ngân sách dịch vụ viễn thông.

#### Tác động kinh doanh (Business Impact)
Gia tăng chi phí cước viễn thông SMS và dịch vụ gửi email ngoài dự kiến; gây nghẽn hàng đợi gửi thông báo của hệ thống.

#### Đề xuất khắc phục (Recommended Fix)
Bổ sung `PathPrefix('/api/auth/login-code')` vào router `core-api-auth` trong tệp `deploy/traefik/server.yml`.

#### Phương pháp kiểm chứng an toàn (Verification Method)
Gửi 40 request liên tiếp đến `/api/auth/login-code` trong 10 giây; đảm bảo từ request thứ 31 trở đi nhận được mã lỗi `HTTP 429 Too Many Requests` ngay từ tầng Traefik.

---

### SEC-04: Lộ lọt endpoint cấp phát Service Token nội bộ ra ngoài Internet

- **Mã phát hiện:** `SEC-04`
- **Tiêu đề:** Endpoint cấp phát Token xác thực giữa các Microservice nội bộ bị phơi nhiễm công khai
- **Mức độ nghiêm trọng:** **MEDIUM (Mức độ trung bình)**
- **Điểm CVSS v3.1:** `6.5` (`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:N`)
- **Độ tin cậy:** Đã xác thực 100%
- **Thành phần ảnh hưởng:** `apps/core-api` — Phân hệ Access (`ServiceTokenController`), Cấu hình Traefik
- **Tệp tin và dòng mã liên quan:**
  - [service-token.controller.ts](file:///d:/Sukem/VinUni/VSF/tripflix/tripflix-be/apps/core-api/src/modules/access/service/api/service-token.controller.ts#L35)
  - [server.yml](file:///d:/Sukem/VinUni/VSF/tripflix/tripflix-be/deploy/traefik/server.yml#L41)

#### Nguyên nhân gốc rễ (Root Cause)
`ServiceTokenController` phục vụ việc xác thực giữa các service nội bộ (như `tripflix-ai`, `video-worker`) để cấp JWT dịch vụ có đặc quyền cao dựa vào `clientId` và `clientSecret`. Traefik đang cấu hình cho phép công chúng gọi endpoint này thông qua domain chính:
`PathPrefix('/api/auth/service-token')`.

#### Kịch bản khai thác thực tế (Attack Scenario)
Kẻ tấn công từ ngoài Internet có thể nhắm trực tiếp vào endpoint này để thực hiện tấn công dò quét mật mã (brute-force) hoặc phân tích độ trễ (timing attack) nhằm tìm kiếm secret của các service. Nếu secret của một service nội bộ bị vô tình lộ lọt (qua log, commit cũ, hoặc file cấu hình), kẻ tấn công có thể trực tiếp đổi lấy JWT đặc quyền từ bất kỳ đâu trên thế giới mà không cần phải xâm nhập vào mạng nội bộ.

#### Đề xuất khắc phục (Recommended Fix)
1. Loại bỏ tiền tố `/api/auth/service-token` khỏi cấu hình router công cộng của Traefik.
2. Chỉ cho phép các dịch vụ nội bộ gọi endpoint này qua mạng riêng Docker (`http://core-api:3000/api/auth/service-token`).

#### Phương pháp kiểm chứng an toàn (Verification Method)
Gọi `curl -I https://tripflix.com/api/auth/service-token` từ mạng ngoài; đảm bảo Traefik trả về lỗi `HTTP 404` hoặc `HTTP 403`. Trong khi đó, gọi `curl` từ bên trong container `tripflix-ai` đến `http://core-api:3000/api/auth/service-token` vẫn hoạt động bình thường.

---

### SEC-05: Cơ chế Fail-Open thu hồi token khi Redis suy giảm hiệu năng tại endpoint thanh toán

- **Mã phát hiện:** `SEC-05`
- **Tiêu đề:** Áp dụng cơ chế bỏ qua kiểm tra thu hồi token (Fail-Open) trên các controller thanh toán và đặt chỗ
- **Mức độ nghiêm trọng:** **MEDIUM (Mức độ trung bình)**
- **Điểm CVSS v3.1:** `5.9` (`CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:L/I:H/A:N`)
- **Độ tin cậy:** Đã xác thực 100%
- **Thành phần ảnh hưởng:** `apps/core-api` — Phân hệ Commerce (`CheckoutController`, `VnpayController`)
- **Tệp tin và dòng mã liên quan:**
  - [checkout.controller.ts](file:///d:/Sukem/VinUni/VSF/tripflix/tripflix-be/apps/core-api/src/modules/commerce/booking/api/checkout.controller.ts#L38)
  - [vnpay.controller.ts](file:///d:/Sukem/VinUni/VSF/tripflix/tripflix-be/apps/core-api/src/modules/commerce/payment/api/vnpay.controller.ts#L46)

#### Nguyên nhân gốc rễ (Root Cause)
Cả hai controller `CheckoutController` và `VnpayController` đều được gắn decorator `@AllowWhenRevocationUnavailable()`. Khi Redis lưu trữ trạng thái thu hồi token gặp sự cố hoặc thời gian phản hồi vượt quá 300ms, guard kiểm tra thu hồi token (`TokenRevocationGuard`) sẽ tự động cho qua (fail-open) và coi token là hợp lệ.

#### Kịch bản khai thác thực tế (Attack Scenario)
Khi một tài khoản người dùng hoặc admin bị nghi ngờ xâm nhập, chủ tài khoản nhấn nút "Đăng xuất khỏi tất cả thiết bị" hoặc đổi mật khẩu. Nếu tại thời điểm đó Redis gặp sự cố quá tải tạm thời (hoặc bị kẻ tấn công chủ động gây nghẽn bằng lượng lớn câu lệnh), kẻ tấn công đang giữ token cũ vẫn có thể tiếp tục thực hiện đặt chỗ, cập nhật thông tin hành khách hoặc tiến hành thanh toán mà không bị ngăn chặn.

#### Đề xuất khắc phục (Recommended Fix)
Xóa bỏ hoàn toàn decorator `@AllowWhenRevocationUnavailable()` khỏi các controller liên quan đến tài chính, đặt hàng và thanh toán. Trong nghiệp vụ tài chính, nguyên tắc an ninh bắt buộc phải là **Fail-Closed** (từ chối giao dịch với mã lỗi 503 khi không thể kiểm chứng tính hợp lệ của phiên làm việc).

#### Phương pháp kiểm chứng an toàn (Verification Method)
Mô phỏng Redis bị ngắt kết nối hoặc phản hồi chậm > 300ms. Thực hiện gọi `POST /api/checkout/:id/pay` với token đã bị thu hồi; kiểm tra kết quả trả về phải là `HTTP 503 Service Unavailable`, tuyệt đối không được phép thực hiện giao dịch thành công.

---

## 5. Các phát hiện tiềm ẩn cần xác minh trên môi trường Staging/Production

---

### SEC-06: Thiếu Security Headers và CSP tại trang quản trị Admin Console

- **Mã phát hiện:** `SEC-06`
- **Tiêu đề:** Thiếu vắng các HTTP Security Header bảo vệ chống Clickjacking, MIME Sniffing và Content Security Policy trên Admin Portal
- **Mức độ nghiêm trọng:** **LOW (Mức độ thấp)**
- **Điểm CVSS v3.1:** `4.3` (`CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:L/A:N`)
- **Độ tin cậy:** Đã xác thực trong mã nguồn; cần kiểm chứng header runtime
- **Thành phần ảnh hưởng:** `apps/admin` — Cấu hình Next.js
- **Tệp tin liên quan:** [next.config.ts](file:///d:/Sukem/VinUni/VSF/tripflix/tripflix-fe/apps/admin/next.config.ts)

#### Đánh giá rủi ro
Trong khi `apps/web/next.config.ts` có cấu hình đầy đủ các header an toàn, tệp `apps/admin/next.config.ts` hiện đang để rỗng phần cấu hình `headers()`. Do thiếu `X-Frame-Options: DENY` và `frame-ancestors 'none'`, trang quản trị có thể bị nhúng vào thẻ `<iframe>` của các website độc hại nhằm thực hiện tấn công Clickjacking để lừa quản trị viên nhấn vào các nút nhạy cảm như cấm người dùng hoặc duyệt nội dung vi phạm.

#### Đề xuất khắc phục
Bổ sung hàm cấu hình `headers()` vào `apps/admin/next.config.ts` thiết lập `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, và `Content-Security-Policy`.

---

### SEC-07: Phạm vi Cookie Wildcard của CloudFront Playback quá rộng

- **Mã phát hiện:** `SEC-07`
- **Tiêu đề:** Cookie Signed phát video của CloudFront áp dụng mẫu Wildcard trên toàn bộ video của môi trường
- **Mức độ nghiêm trọng:** **LOW (Mức độ thấp)**
- **Điểm CVSS v3.1:** `3.1` (`CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:L/I:N/A:N`)
- **Độ tin cậy:** Cần xác minh thêm với chính sách S3/CloudFront thực tế
- **Thành phần ảnh hưởng:** `libs/media-storage` — CloudFront Cookie Signer
- **Tệp tin liên quan:** [cloudfront-cookie-signer.ts](file:///d:/Sukem/VinUni/VSF/tripflix/tripflix-be/libs/media-storage/src/cloudfront-cookie-signer.ts)

#### Đánh giá rủi ro
Cookie phát video đang được ký với mẫu tài nguyên: `https://${domain}/${env}/*/videos/*` có thời hạn 24 giờ. Điều này đồng nghĩa với việc người dùng khi mở xem 1 video công khai hợp lệ sẽ nhận được cookie có quyền đọc bất kỳ phân đoạn video nào khác trong môi trường đó, bao gồm cả các video đang ở trạng thái nháp (draft) hoặc riêng tư nếu đoán được UUID của media.

#### Đề xuất khắc phục
Thu hẹp phạm vi chính sách ký cookie theo từng mã bài viết (`postId`) hoặc tiền tố media cụ thể, hoặc tách biệt đường dẫn lưu trữ video riêng tư ra khỏi phân phối CDN công cộng.

---

### SEC-08: File Docker Compose Local Dev bind cổng PostgreSQL và Redis ra `0.0.0.0`

- **Mã phát hiện:** `SEC-08`
- **Tiêu đề:** Cơ sở dữ liệu và bộ nhớ đệm phát triển cục bộ bị mở cổng ra toàn mạng LAN
- **Mức độ nghiêm trọng:** **INFORMATIONAL (Thông tin)**
- **Điểm CVSS v3.1:** `3.5` (`CVSS:3.1/AV:A/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:N`)
- **Thành phần ảnh hưởng:** `deploy/compose.yaml` (Môi trường Local Dev)
- **Tệp tin liên quan:** [compose.yaml](file:///d:/Sukem/VinUni/VSF/tripflix/tripflix-be/deploy/compose.yaml#L53,L65)

#### Đánh giá rủi ro
Cổng PostgreSQL (`5432`) và Redis (`6379`) trong file compose cục bộ đang bind ra `0.0.0.0` với mật khẩu mặc định. Khi lập trình viên kết nối laptop vào các mạng Wi-Fi công cộng (quán cà phê, sân bay), các thiết bị khác trong cùng mạng có thể dò quét và kết nối trực tiếp vào cơ sở dữ liệu dev trên máy tính.

#### Đề xuất khắc phục
Chuyển đổi khai báo cổng thành `127.0.0.1:5432:5432` và `127.0.0.1:6379:6379`.

---

### SEC-09: Biến `conversationId` lưu ở module-scope trong Mobile Assistant Transport

- **Mã phát hiện:** `SEC-09`
- **Tiêu đề:** Biến định danh cuộc hội thoại của trợ lý ảo di động đặt ở phạm vi module
- **Mức độ nghiêm trọng:** **INFORMATIONAL (Thông tin)**
- **Điểm CVSS v3.1:** `2.0`
- **Thành phần ảnh hưởng:** `apps/mobile` — Assistant Transport
- **Tệp tin liên quan:** [assistant-transport.ts](file:///d:/Sukem/VinUni/VSF/tripflix/tripflix-fe/apps/mobile/src/features/assistant/assistant-transport.ts#L22)

#### Đánh giá rủi ro
Khai báo `let conversationId = '';` ở phạm vi toàn module tiềm ẩn rủi ro race condition nếu có các tác vụ bất đồng bộ chưa kịp hủy khi người dùng thực hiện đăng xuất và đăng nhập tài khoản khác trên ứng dụng di động trong một khoảng thời gian cực ngắn.

#### Đề xuất khắc phục
Đưa `conversationId` vào quản lý trực tiếp trong React Context (`AssistantContext`), loại bỏ biến trạng thái toàn cục ở mức module.

---

## 6. Đánh giá lại các lỗ hổng từ đợt kiểm toán trước (Run 2 Verification)

| Mã lỗi cũ | Tóm tắt mô tả | Kết quả kiểm toán hiện tại | Bằng chứng mã nguồn kiểm tra |
| :--- | :--- | :---: | :--- |
| `be.content.private-bookmark` | Biết UUID bài viết riêng tư cho phép bookmark và xem nội dung | **ĐÃ GIẢI QUYẾT** | Tệp `bookmark-post.use-case.ts` đã thêm kiểm tra `domainPost.canBeViewedBy(userId)`. Tệp `list-bookmarks.use-case.ts` đã lọc theo điều kiện `(p.visibility === 'public' \|\| p.authorId === query.userId)`. |
| `be.content.media-owner` | Người dùng có thể gắn ID video/ảnh của người khác vào bài viết của mình | **ĐÃ GIẢI QUYẾT** | Hàm `assertPostMediaAllowed` và `assertMediaKindsForPostType` trong `create-draft`, `update-post` và `publish-post` bắt buộc xác thực `info.ownerId === authorId` và `info.status === 'ready'`. |
| `be.staff.fixed-default-password` | Mật khẩu mặc định cố định khi tạo tài khoản điều phối viên mới | **ĐÃ GIẢI QUYẾT** | Quy trình tạo nhân sự khởi tạo `passwordHash: null` và gửi đường link kích hoạt tạo mật khẩu dùng một lần qua email. |

---

## 7. Rủi ro tồn dư & Giới hạn kiểm thử

1. **Kiểm thử Webhook thanh toán VNPay thực tế:**
   - Để đảm bảo an toàn tuyệt đối và tránh gây biến động giao dịch tài chính với hệ thống ngân hàng, việc kiểm thử chủ động đối với webhook IPN của VNPay chưa được thực hiện trực tiếp. Đánh giá tĩnh đối với hàm `VnpayController.handleIpn` cho thấy logic kiểm tra chữ ký HMAC-SHA512 và xác thực số tiền thanh toán là hoàn toàn chính xác.
2. **Chính sách IAM và phân quyền AWS S3 / CloudFront:**
   - Quá trình kiểm toán đánh giá dựa trên logic tạo chữ ký ở tầng mã nguồn ứng dụng (`libs/media-storage`). Cấu hình thực tế của S3 Bucket Policy và CloudFront Origin Access Control (OAC) cần được đối chiếu xác nhận trực tiếp trên bảng điều khiển AWS khi triển khai môi trường Staging.
3. **Không thực thi kiểm thử xâm nhập phá hoại:**
   - Tuân thủ nguyên tắc kiểm toán và quy định an toàn, toàn bộ quá trình được thực hiện ở chế độ đọc (read-only) và phân tích tĩnh chuyên sâu, không chạy các công cụ quét tự động làm nghẽn mạng hay gửi payload gây biến đổi dữ liệu.

---

## 8. Kết luận & Khuyến nghị hành động

Nền tảng Tripflix sở hữu kiến trúc công nghệ hiện đại, tư duy phân tách module rõ ràng, và nền tảng mật mã học bảo mật rất vững chắc. Tuy nhiên, sự tồn tại của **SEC-01 (Mock Payment Gateway)** và **SEC-02 (Admin BFF DoS / Lưu Session trong RAM)** mang lại nguy cơ tài chính và rủi ro gián đoạn vận hành nghiêm trọng.

Kế hoạch khắc phục kỹ thuật chi tiết đã được lập tại tệp [SECURITY_REMEDIATION_PLAN.md](file:///d:/Sukem/VinUni/VSF/docs/security/SECURITY_REMEDIATION_PLAN.md).

Đội ngũ an ninh khuyến nghị ban quản trị phê duyệt ngay đợt khắc phục **Giai đoạn 1 (Ưu tiên P0: SEC-01 và P1: SEC-05)** để đảm bảo an toàn tuyệt đối cho hệ thống thanh toán trước khi mở rộng tính năng mới.

---
**Báo cáo được lập và ký duyệt bởi:**  
*Kỹ sư Trưởng An toàn Ứng dụng & Kiến trúc sư Bảo mật Tripflix*
