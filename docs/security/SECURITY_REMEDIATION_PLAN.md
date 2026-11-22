# KẾ HOẠCH KHẮC PHỤC BẢO MẬT NỀN TẢNG TRIPFLIX

**Mã tài liệu:** `SEC-REM-2026-11`  
**Ngày lập:** 20 tháng 11, 2026  
**Trạng thái:** Sẵn sàng thẩm định & Triển khai mã nguồn  
**Tài liệu báo cáo đi kèm:** [SECURITY_AUDIT_REPORT.md](file:///d:/Sukem/VinUni/VSF/docs/security/SECURITY_AUDIT_REPORT.md)  

---

## 1. Tổng quan & Chiến lược khắc phục

Tài liệu này cung cấp kế hoạch kỹ thuật chi tiết, được phân loại theo mức độ ưu tiên, nhằm khắc phục dứt điểm các lỗ hổng bảo mật và điểm yếu cấu hình đã được ghi nhận trong báo cáo kiểm toán bảo mật của hệ thống **Tripflix**.

### Nguyên tắc triển khai khắc phục
1. **Không làm gián đoạn nghiệp vụ (Zero-Disruption):** Các bản vá không được gây ảnh hưởng đến quy trình thanh toán hợp lệ của khách hàng, luồng đăng nhập, khả năng phát video mượt mà, hoặc các tác vụ kiểm duyệt của quản trị viên.
2. **Phòng thủ theo chiều sâu (Defense-in-Depth):** Kiểm soát bảo mật phải được thiết lập ở nhiều lớp: Cổng biên Ingress/Reverse Proxy, Guard kiểm soát tầng API, logic kiểm tra nghiệp vụ tầng Ứng dụng, và ràng buộc tầng Cơ sở dữ liệu.
3. **Nguyên tắc từ chối an toàn (Fail-Closed) cho luồng Tài chính:** Các thao tác liên quan đến giữ chỗ, thanh toán, hoàn tiền bắt buộc phải từ chối giao dịch nếu không thể xác thực chắc chắn tính hợp lệ của phiên làm việc.
4. **Cách ly tuyệt đối mã thử nghiệm khỏi môi trường Production:** Toàn bộ controller thử nghiệm, mock gateway, hoặc thẻ test phải bị loại bỏ hoàn toàn khỏi build production và chặn truy cập từ cổng biên.

---

## 2. Danh mục khắc phục theo thứ tự ưu tiên

| Mức ưu tiên | Mã lỗ hổng | Tên hạng mục khắc phục | Phân hệ bị ảnh hưởng | Mức độ nghiêm trọng | Thời gian dự kiến |
| :---: | :---: | :--- | :--- | :---: | :---: |
| **P0** | **SEC-01** | Loại bỏ Mock Payment Gateway ở Production & Khóa đường dẫn tại Ingress | `tripflix-be/apps/core-api` | **CRITICAL** | **ĐÃ HOÀN THÀNH (PR #318)** |
| **P1** | **SEC-02** | Chuyển đổi quản lý Session Admin BFF sang Stateless Sealed Cookie | `tripflix-fe/apps/admin` | **HIGH** | **ĐÃ HOÀN THÀNH (Commit da0fa06)** |
| **P1** | **SEC-05** | Áp dụng Fail-Closed thu hồi token trên các Controller thanh toán & đặt hàng | `tripflix-be/apps/core-api` | **MEDIUM** | **ĐÃ HOÀN THÀNH (Commit c047376)** |
| **P2** | **SEC-03** | Bổ sung Rate Limiting cho endpoint `POST /api/auth/login-code` tại Traefik | `tripflix-be/deploy/traefik` | **MEDIUM** | **ĐÃ HOÀN THÀNH (Commit 4b4ee96)** |
| **P2** | **SEC-04** | Chặn truy cập công cộng vào endpoint cấp phát Service Token nội bộ | `tripflix-be/deploy/traefik` | **MEDIUM** | **ĐÃ HOÀN THÀNH (Commit 4b4ee96)** |
| **P3** | **SEC-06** | Thêm HTTP Security Headers, CSP và chống Clickjacking cho Admin Console | `tripflix-fe/apps/admin` | **LOW** | **ĐÃ HOÀN THÀNH (Commit da0fa06)** |
| **P3** | **SEC-07** | Thu hẹp phạm vi Signed Cookie CloudFront theo từng tài nguyên video | `tripflix-be/apps/core-api` | **LOW** | **ĐÃ HOÀN THÀNH (Commit 830a94b)** |
| **P4** | **SEC-08** | Chuyển cấu hình cổng Docker Compose Dev về `127.0.0.1` | `tripflix-be/deploy/compose.yaml` | **INFORMATIONAL** | **ĐÃ HOÀN THÀNH (Commit 830a94b)** |
| **P4** | **SEC-09** | Đưa biến `conversationId` vào React State trong ứng dụng Mobile | `tripflix-fe/apps/mobile` | **INFORMATIONAL** | **ĐÃ HOÀN THÀNH (Commit 4287ffd)** |

---

## 3. Lộ trình triển khai phân kỳ

```mermaid
flowchart TD
    subgraph Giai đoạn 1: Bản vá Khẩn cấp & Tài chính
        P0[P0: SEC-01 Loại bỏ Mock Gateway ở Prod]
        P1A[P1: SEC-05 Fail-Closed cho Checkout & Payment]
    end

    subgraph Giai đoạn 2: Củng cố Ingress & Kiến trúc Session
        P1B[P1: SEC-02 Quản lý Session Admin BFF qua Redis]
        P2A[P2: SEC-03 Traefik Rate-Limit cho login-code]
        P2B[P2: SEC-04 Cô lập Ingress cho Service-Token]
    end

    subgraph Giai đoạn 3: Gia cố Ứng dụng & Hạ tầng Client
        P3A[P3: SEC-06 Thêm Security Headers & CSP cho Admin]
        P3B[P3: SEC-07 Thu hẹp phạm vi Cookie CloudFront]
        P4A[P4: SEC-08 Localhost Bindings cho Compose Dev]
        P4B[P4: SEC-09 Đóng gói State trong Mobile Transport]
    end

    subgraph Giai đoạn 4: Kiểm thử Hồi quy & Nghiệm thu
        V1[Chạy E2E Checkout & Kiểm thử thanh toán VNPay]
        V2[Kiểm thử tải & Đồng bộ Session đa node Admin]
        V3[Quét lỗ hổng Ingress & Kiểm tra Rate Limit biên]
    end

    Giai đoạn 1 --> Giai đoạn 2
    Giai đoạn 2 --> Giai đoạn 3
    Giai đoạn 3 --> Giai đoạn 4
```

---

## 4. Đặc tả kỹ thuật chi tiết từng hạng mục khắc phục

---

### Nhiệm vụ P0-1: Loại bỏ Mock Payment Gateway & Kích hoạt cổng thanh toán thật (SEC-01)

- **Mã phát hiện:** `SEC-01`
- **Thành phần:** `tripflix-be/apps/core-api` — Phân hệ `CommerceModule`
- **Tệp tin cần sửa đổi:**
  - `apps/core-api/src/modules/commerce/commerce.module.ts`
  - `apps/core-api/src/modules/commerce/payment/api/mock-gateway.controller.ts`
  - `deploy/traefik/server.yml`
- **Mức độ phụ thuộc:** Không phụ thuộc
- **Trạng thái thực hiện:** **ĐÃ HOÀN THÀNH (DONE)** — Đã được merge vào nhánh `develop` qua PR `#318` (Commit `193f977`). Đã pass 100% các ca kiểm thử hồi quy e2e (`mock-payment.e2e.spec.ts`).

#### Các bước triển khai cụ thể
1. Sửa đổi `commerce.module.ts` để chỉ đăng ký `MockGatewayController` khi biến môi trường cho phép rõ ràng:
   ```typescript
   // apps/core-api/src/modules/commerce/commerce.module.ts
   const isMockPaymentAllowed =
     process.env.NODE_ENV !== 'production' &&
     process.env.ENABLE_MOCK_PAYMENT === 'true';

   const commerceControllers = [
     CartController,
     CheckoutController,
     VnpayController,
     ...(isMockPaymentAllowed ? [MockGatewayController] : []),
   ];

   const paymentGatewayProvider: Provider = isMockPaymentAllowed
     ? { provide: PAYMENT_GATEWAY, useClass: MockGateway }
     : { provide: PAYMENT_GATEWAY, useClass: VnpayGateway };
   ```
2. Thêm quy tắc chặn ở mức cao nhất tại Traefik (`deploy/traefik/server.yml`):
   ```yaml
   # Chặn hoàn toàn endpoint mock payment từ bên ngoài
   http:
     routers:
       block-mock-gateway:
         rule: "Host(`{{env \"DOMAIN\"}}`) && PathPrefix(`/api/mock-gateway`)"
         priority: 1000
         service: noop@internal
         middlewares:
           - block-ip
   ```

#### Yêu cầu kiểm thử hồi quy
- Chạy toàn bộ test suite của commerce: `pnpm test apps/core-api/src/modules/commerce/booking/application/checkout.use-cases.spec.ts`.
- Chạy e2e kiểm thử luồng tạo liên kết thanh toán VNPay thật để đảm bảo không bị ảnh hưởng.

#### Tiêu chí nghiệm thu (Verification Criteria)
- Gửi `GET /api/mock-gateway/test-cards` trên môi trường chạy `NODE_ENV=production` phải trả về mã lỗi `HTTP 404 Not Found` hoặc `HTTP 403 Forbidden`.
- Gọi `POST /api/checkout/:id/pay` với card token giả `tok_mock_...` phải bị từ chối với lỗi `PaymentFailedException`.

---

### Nhiệm vụ P1-1: Chuyển đổi quản lý Session Admin BFF sang Redis phân tán (SEC-02)

- **Mã phát hiện:** `SEC-02`
- **Thành phần:** `tripflix-fe/apps/admin` — Route Handler của BFF Proxy
- **Tệp tin cần sửa đổi:**
  - `apps/admin/src/app/bff/api/[...path]/route.ts`
  - `apps/admin/src/lib/session-store.ts` (tạo mới)
- **Mức độ phụ thuộc:** Kết nối mạng tới dịch vụ Redis (`REDIS_URL`) từ container `apps/admin`

#### Các bước triển khai cụ thể
1. Tạo module kết nối Redis dùng chung cho Admin BFF (`apps/admin/src/lib/session-store.ts`):
   ```typescript
   import Redis from 'ioredis';

   const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
   export const sessionRedis = new Redis(redisUrl, {
     keyPrefix: 'admin:bff:session:',
     maxRetriesPerRequest: 3,
     lazyConnect: true,
   });

   export async function getBffSession(sessionId: string): Promise<SessionData | null> {
     const raw = await sessionRedis.get(sessionId);
     return raw ? JSON.parse(raw) : null;
   }

   export async function setBffSession(
     sessionId: string,
     data: SessionData,
     ttlSeconds = 86400,
   ): Promise<void> {
     await sessionRedis.setex(sessionId, ttlSeconds, JSON.stringify(data));
   }

   export async function deleteBffSession(sessionId: string): Promise<void> {
     await sessionRedis.del(sessionId);
   }
   ```
2. Thay thế `sessions = new Map()` trong `route.ts` bằng các hàm `getBffSession`, `setBffSession`, và `deleteBffSession`.
3. Xóa bỏ hoàn toàn điều kiện giới hạn 1.000 session: `if (sessions.size >= maxSessions) return reply(503)`. Redis có khả năng quản lý hàng triệu key với cơ chế tự động giải phóng bộ nhớ khi hết hạn TTL.

#### Yêu cầu kiểm thử hồi quy
- Kiểm thử luồng đăng nhập admin, xoay vòng cookie, thực hiện các thao tác kiểm duyệt, và đăng xuất.

#### Tiêu chí nghiệm thu (Verification Criteria)
- Chạy đồng thời 2 container `apps/admin`. Đăng nhập trên Instance 1, thực hiện các request duyệt nội dung được định tuyến sang Instance 2; phiên làm việc phải được duy trì hợp lệ 100%.
- Tạo hơn 1.005 session đăng nhập đồng thời không xảy ra lỗi HTTP 503.

---

### Nhiệm vụ P1-2: Áp dụng Fail-Closed thu hồi token trên Controller thanh toán (SEC-05)

- **Mã phát hiện:** `SEC-05`
- **Thành phần:** `tripflix-be/apps/core-api` — Phân hệ Commerce
- **Tệp tin cần sửa đổi:**
  - `apps/core-api/src/modules/commerce/booking/api/checkout.controller.ts`
  - `apps/core-api/src/modules/commerce/payment/api/vnpay.controller.ts`
- **Mức độ phụ thuộc:** Không phụ thuộc

#### Các bước triển khai cụ thể
1. Xóa bỏ decorator `@AllowWhenRevocationUnavailable()` khỏi `CheckoutController`:
   ```diff
   - @AllowWhenRevocationUnavailable()
   @Controller('checkout')
   export class CheckoutController {
   ```
2. Xóa bỏ decorator `@AllowWhenRevocationUnavailable()` khỏi `VnpayController`:
   ```diff
   - @AllowWhenRevocationUnavailable()
   @Controller('payment/vnpay')
   export class VnpayController {
   ```

#### Yêu cầu kiểm thử hồi quy
- Chạy `pnpm test apps/core-api/src/modules/commerce/payment/payment.e2e.spec.ts`.
- Đảm bảo khi Redis hoạt động bình thường, các thao tác thanh toán vẫn diễn ra trơn tru.

#### Tiêu chí nghiệm thu (Verification Criteria)
- Giả lập ngắt kết nối Redis hoặc cấu hình độ trễ mạng > 300ms. Gọi API `POST /api/checkout/:id/pay` phải lập tức trả về mã lỗi `HTTP 503 Service Unavailable`, tuyệt đối không cho phép thanh toán khi chưa kiểm chứng được token.

---

### Nhiệm vụ P2-1: Bổ sung Rate Limiting cho `POST /api/auth/login-code` (SEC-03)

- **Mã phát hiện:** `SEC-03`
- **Thành phần:** `tripflix-be/deploy/traefik` — Cấu hình Ingress Reverse Proxy
- **Tệp tin cần sửa đổi:** `deploy/traefik/server.yml`
- **Mức độ phụ thuộc:** Không phụ thuộc

#### Các bước triển khai cụ thể
Cập nhật router `core-api-auth` để bổ sung tiền tố `/api/auth/login-code`:
```yaml
# deploy/traefik/server.yml
    core-api-auth:
      rule: "Host(`{{env \"DOMAIN\"}}`) && (PathPrefix(`/api/auth/login`) || PathPrefix(`/api/auth/login-code`) || PathPrefix(`/api/auth/register`) || PathPrefix(`/api/auth/registration-code`) || PathPrefix(`/api/auth/google`) || PathPrefix(`/api/auth/password/forgot`) || PathPrefix(`/api/auth/password/reset`))"
      entryPoints: [websecure]
      tls: {}
      middlewares: [rate-limit-auth]
      service: core-api-service
      priority: 200
```

#### Tiêu chí nghiệm thu (Verification Criteria)
- Bắn 40 request liên tiếp đến `POST /api/auth/login-code` trong 10 giây; từ request thứ 31 trở đi nhận được mã lỗi `HTTP 429 Too Many Requests` trả về trực tiếp từ Traefik.

---

### Nhiệm vụ P2-2: Chặn truy cập công cộng vào endpoint Service Token (SEC-04)

- **Mã phát hiện:** `SEC-04`
- **Thành phần:** `tripflix-be/deploy/traefik` — Cấu hình Ingress
- **Tệp tin cần sửa đổi:** `deploy/traefik/server.yml`
- **Mức độ phụ thuộc:** Đảm bảo các service nội bộ (`ai-service`, `worker`) gọi qua URL nội bộ `http://core-api:3000`.

#### Các bước triển khai cụ thể
1. Bỏ `PathPrefix('/api/auth/service-token')` khỏi router công cộng.
2. Thêm quy tắc chặn tại router biên của Traefik:
   ```yaml
   http:
     routers:
       block-service-token:
         rule: "Host(`{{env \"DOMAIN\"}}`) && PathPrefix(`/api/auth/service-token`)"
         priority: 300
         service: noop@internal
         middlewares:
           - block-ip
   ```

#### Tiêu chí nghiệm thu (Verification Criteria)
- Từ máy tính bên ngoài: `curl -I https://tripflix.com/api/auth/service-token` trả về `HTTP 404` hoặc `HTTP 403`.
- Từ bên trong container `ai-service`: `curl -I http://core-api:3000/api/auth/service-token` hoạt động bình thường.

---

### Nhiệm vụ P3-1: Bổ sung Security Headers & CSP cho Admin Console (SEC-06)

- **Mã phát hiện:** `SEC-06`
- **Thành phần:** `tripflix-fe/apps/admin` — Cấu hình Next.js
- **Tệp tin cần sửa đổi:** `apps/admin/next.config.ts`

#### Các bước triển khai cụ thể
Cập nhật `apps/admin/next.config.ts` để cấu hình hàm `headers()`:
```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@tripflix/api-client', '@tripflix/app-core', '@tripflix/i18n'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https:",
              "frame-ancestors 'none'",
            ].join('; '),
          },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
```

#### Tiêu chí nghiệm thu (Verification Criteria)
- Kiểm tra qua cURL: `curl -I http://localhost:3002/` trả về đầy đủ các header `x-frame-options: DENY`, `x-content-type-options: nosniff` và `content-security-policy`.
- Không có lỗi CSP trong DevTools console khi thực hiện các tác vụ quản trị thông thường.

---

### Nhiệm vụ P3-2: Thu hẹp phạm vi Cookie Signed CloudFront (SEC-07)

- **Mã phát hiện:** `SEC-07`
- **Thành phần:** `tripflix-be/libs/media-storage`
- **Tệp tin cần sửa đổi:** `libs/media-storage/src/cloudfront-cookie-signer.ts`

#### Các bước triển khai cụ thể
Cho phép hàm ký cookie nhận tham số mã bài viết (`postId`) hoặc tiền tố cụ thể thay vì luôn dùng dấu sao đại diện (`*`):
```typescript
export function createPlaybackPolicy(
  domain: string,
  env: string,
  postId?: string,
): string {
  const resourcePattern = postId
    ? `https://${domain}/${env}/${postId}/videos/*`
    : `https://${domain}/${env}/public/videos/*`;

  return JSON.stringify({
    Statement: [
      {
        Resource: resourcePattern,
        Condition: {
          DateLessThan: {
            'AWS:EpochTime': Math.floor(Date.now() / 1000) + 86400,
          },
        },
      },
    ],
  });
}
```

---

### Nhiệm vụ P4-1: Chuyển cấu hình cổng Docker Compose Dev về `127.0.0.1` (SEC-08)

- **Mã phát hiện:** `SEC-08`
- **Thành phần:** `tripflix-be/deploy/compose.yaml`
- **Tệp tin cần sửa đổi:** `deploy/compose.yaml`

#### Các bước triển khai cụ thể
```diff
    ports:
-     - '5432:5432'
+     - '127.0.0.1:5432:5432'
...
    ports:
-     - '6379:6379'
+     - '127.0.0.1:6379:6379'
```

---

### Nhiệm vụ P4-2: Đóng gói State trong Mobile Assistant Transport (SEC-09)

- **Mã phát hiện:** `SEC-09`
- **Thành phần:** `tripflix-fe/apps/mobile`
- **Tệp tin cần sửa đổi:**
  - `apps/mobile/src/features/assistant/assistant-transport.ts`
  - `apps/mobile/src/features/assistant/assistant-provider.tsx`

#### Các bước triển khai cụ thể
Loại bỏ biến module `let conversationId = '';`. Truyền `conversationId` qua `AssistantContext` do React Hook `useAssistantState` quản lý, đảm bảo sinh mới hoàn toàn mỗi khi người dùng đổi phiên đăng nhập.

---

## 5. Thiết lập cổng kiểm soát an ninh tự động trong CI/CD

Nhằm ngăn chặn lỗ hổng tái diễn trong quá trình phát triển tiếp theo, hệ thống CI/CD cần được cấu hình bổ sung các bước kiểm tra tự động sau:

1. **Quét lỗ hổng thư viện phụ thuộc (Dependency Audit):**
   ```bash
   pnpm audit --prod --audit-level high
   ```
   *Quy tắc:* Tự động chặn merge Pull Request nếu phát hiện lỗ hổng mức High hoặc Critical trong các thư viện production.
2. **Quét lộ lọt mã bí mật (Gitleaks / Secret Scanning):**
   *Quy tắc:* Chặn commit nếu chứa khóa bí mật của OpenAI, DeepSeek, AWS hoặc VNPay.
3. **Kịch bản kiểm tra Controller thử nghiệm trước khi Build Production:**
   ```typescript
   // scripts/assert-no-mock-in-prod.ts
   if (process.env.NODE_ENV === 'production') {
     const fs = require('fs');
     const content = fs.readFileSync('apps/core-api/src/modules/commerce/commerce.module.ts', 'utf8');
     if (content.includes('MockGatewayController') && !content.includes('isMockPaymentAllowed')) {
       console.error('LỖI AN NINH NGHIÊM TRỌNG: MockGatewayController chưa được cô lập khỏi môi trường Production!');
       process.exit(1);
     }
   }
   ```

---

## 6. Ký duyệt & Đề xuất hành động tiếp theo

Đội ngũ an ninh khuyến nghị bắt đầu triển khai ngay **Giai đoạn 1 (Nhiệm vụ P0-1: SEC-01 và P1-2: SEC-05)** nhằm vô hiệu hóa hoàn toàn rủi ro gian lận thanh toán.

- **Thời gian hoàn thành mục tiêu Giai đoạn 1:** Trong vòng 24 giờ sau khi được phê duyệt.
- **Thời gian hoàn thành mục tiêu Giai đoạn 2:** Trong vòng 3 ngày làm việc.
- **Nghiệm thu toàn bộ:** Trước khi mở cổng thử nghiệm diện rộng.

---
*Tài liệu đang chờ xác nhận phê duyệt từ Trưởng dự án và Kỹ sư trưởng trước khi tiến hành cập nhật mã nguồn.*
