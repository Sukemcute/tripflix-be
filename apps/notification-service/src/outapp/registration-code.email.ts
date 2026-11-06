import type { AccessRegistrationCodeRequestedV1 } from '@tripflix/contracts';
import type { EmailMessage } from './mailer.js';

export function buildRegistrationCodeEmail(payload: AccessRegistrationCodeRequestedV1): EmailMessage {
  const intro = 'Nhập mã này trên màn hình đăng ký Tripflix. Mã có hiệu lực trong 10 phút.';
  const warning = 'Không chia sẻ mã với người khác. Nếu bạn không yêu cầu đăng ký, hãy bỏ qua email này.';
  return {
    to: payload.email,
    subject: 'Mã xác thực đăng ký Tripflix',
    text: `${intro}\n\nMã xác thực: ${payload.code}\n\n${warning}`,
    html: `<p>${intro}</p><p><strong>${payload.code}</strong></p><p>${warning}</p>`,
  };
}
