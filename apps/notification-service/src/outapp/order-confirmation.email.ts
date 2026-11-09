import type { CommerceOrderPaidV1 } from '@tripflix/contracts';
import { EMAIL_FOOTER, EMAIL_WRAPPER_OPEN, escapeHtml } from './html.js';
import type { EmailMessage } from './mailer.js';

type OrderItem = CommerceOrderPaidV1['items'][number];

const formatDate = (isoDate: string) => isoDate.slice(0, 10).split('-').reverse().join('/');

const formatMoney = (amount: number) => `${amount.toLocaleString('vi-VN')}đ`;

const PASSENGER_LABELS = { adult: 'Người lớn', child: 'Trẻ em', infant: 'Em bé' };

const addDays = (isoDate: string, days: number) => new Date(Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const formatTime = (time: string | null) => time?.slice(0, 5) ?? '';

const joinParts = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');

function describeRoom(item: OrderItem): string {
  const isDetailed = Boolean(item.productName);
  return joinParts([
    item.propertyName ?? (isDetailed ? null : 'Phòng khách sạn'),
    item.productName,
    item.ratePlanName,
    `nhận phòng ${formatDate(item.date)}`,
    isDetailed ? `trả phòng ${formatDate(addDays(item.date, item.nights))}` : null,
    `${item.nights} đêm`,
    `${item.qty} phòng`,
  ]);
}

function describeFlight(item: OrderItem): string {
  if (!item.flight) return joinParts([item.productName ?? 'Vé máy bay', item.ratePlanName, `ngày bay ${formatDate(item.date)}`, `${item.qty} ghế`]);
  const { fromAirport, toAirport, departTime, arriveTime } = item.flight;
  const times = departTime ? [formatTime(departTime), formatTime(arriveTime)].filter(Boolean).join('–') : null;
  return joinParts([item.productName, item.ratePlanName, `${fromAirport} → ${toAirport}`, formatDate(item.date), times, `${item.qty} ghế`]);
}

const describeItem = (item: OrderItem) => (item.productType === 'room' ? describeRoom(item) : describeFlight(item));

/** Email xác nhận đặt chỗ gửi tới email khách nhập khi đặt. */
export function buildOrderConfirmationEmail(payload: CommerceOrderPaidV1, email: string): EmailMessage {
  const greeting = payload.contactName ? `Chào ${payload.contactName},` : 'Chào bạn,';
  const codeLine = payload.confirmationCode ? `Mã xác nhận: ${payload.confirmationCode}` : `Mã đơn: ${payload.orderId}`;
  const items = payload.items.map(describeItem);
  const guests = (payload.guests ?? []).map((guest) => (guest.passengerType ? `${guest.fullName} (${PASSENGER_LABELS[guest.passengerType]})` : guest.fullName));
  const guestLines = guests.length ? ['', 'Hành khách:', ...guests.map((guest) => `- ${guest}`)] : [];
  const totalLine = `Tổng thanh toán: ${formatMoney(payload.total)}`;
  return {
    to: email,
    subject: payload.confirmationCode ? `Xác nhận đặt chỗ Tripflix ${payload.confirmationCode}` : 'Xác nhận đặt chỗ Tripflix',
    text: [greeting, '', 'Đơn đặt chỗ của bạn đã được thanh toán thành công.', codeLine, '', ...items.map((item) => `- ${item}`), ...guestLines, '', totalLine, '', 'Tripflix · Chạm cảm hứng, trọn hành trình.'].join('\n'),
    html: [
      EMAIL_WRAPPER_OPEN,
      '<p style="font-size:22px;font-weight:700;margin:0 0 16px">Đặt chỗ thành công</p>',
      `<p>${escapeHtml(greeting)}</p>`,
      '<p>Đơn đặt chỗ của bạn đã được thanh toán thành công.</p>',
      `<p style="font-weight:700">${escapeHtml(codeLine)}</p>`,
      `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`,
      ...(guests.length ? ['<p style="font-weight:700;margin-bottom:0">Hành khách</p>', `<ul>${guests.map((guest) => `<li>${escapeHtml(guest)}</li>`).join('')}</ul>`] : []),
      `<p style="font-weight:700">${escapeHtml(totalLine)}</p>`,
      EMAIL_FOOTER,
      '</div>',
    ].join('\n'),
  };
}
