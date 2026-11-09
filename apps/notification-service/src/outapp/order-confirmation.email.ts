import type { CommerceOrderPaidV1 } from '@tripflix/contracts';
import { EMAIL_FOOTER, EMAIL_WRAPPER_OPEN, escapeHtml } from './html.js';
import type { EmailMessage } from './mailer.js';

type OrderItem = CommerceOrderPaidV1['items'][number];

const formatDate = (isoDate: string) => isoDate.slice(0, 10).split('-').reverse().join('/');

const formatMoney = (amount: number) => `${amount.toLocaleString('vi-VN')}đ`;

function describeItem(item: OrderItem): string {
  return item.productType === 'room'
    ? `Phòng khách sạn · nhận phòng ${formatDate(item.date)} · ${item.nights} đêm · ${item.qty} phòng`
    : `Vé máy bay · ngày bay ${formatDate(item.date)} · ${item.qty} ghế`;
}

/** Email xác nhận đặt chỗ gửi tới email khách nhập khi đặt. */
export function buildOrderConfirmationEmail(payload: CommerceOrderPaidV1, email: string): EmailMessage {
  const greeting = payload.contactName ? `Chào ${payload.contactName},` : 'Chào bạn,';
  const codeLine = payload.confirmationCode ? `Mã xác nhận: ${payload.confirmationCode}` : `Mã đơn: ${payload.orderId}`;
  const items = payload.items.map(describeItem);
  const totalLine = `Tổng thanh toán: ${formatMoney(payload.total)}`;
  return {
    to: email,
    subject: payload.confirmationCode ? `Xác nhận đặt chỗ Tripflix ${payload.confirmationCode}` : 'Xác nhận đặt chỗ Tripflix',
    text: [greeting, '', 'Đơn đặt chỗ của bạn đã được thanh toán thành công.', codeLine, '', ...items.map((item) => `- ${item}`), '', totalLine, '', 'Tripflix · Chạm cảm hứng, trọn hành trình.'].join('\n'),
    html: [
      EMAIL_WRAPPER_OPEN,
      '<p style="font-size:22px;font-weight:700;margin:0 0 16px">Đặt chỗ thành công</p>',
      `<p>${escapeHtml(greeting)}</p>`,
      '<p>Đơn đặt chỗ của bạn đã được thanh toán thành công.</p>',
      `<p style="font-weight:700">${escapeHtml(codeLine)}</p>`,
      `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`,
      `<p style="font-weight:700">${escapeHtml(totalLine)}</p>`,
      EMAIL_FOOTER,
      '</div>',
    ].join('\n'),
  };
}
