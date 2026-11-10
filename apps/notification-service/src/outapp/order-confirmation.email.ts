import type { CommerceOrderPaidV1 } from '@tripflix/contracts';
import { escapeHtml } from './html.js';
import type { EmailMessage } from './mailer.js';

type OrderItem = CommerceOrderPaidV1['items'][number];

const formatDate = (isoDate: string) => isoDate.slice(0, 10).split('-').reverse().join('/');

const formatMoney = (amount: number) => `${amount.toLocaleString('vi-VN')}đ`;

const formatPhone = (phone: string): string => phone.length === 10 ? phone.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3') : phone;

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

// Tách trình bày để giữ nguyên mô tả trong phần văn bản.
function renderOrderItem(item: OrderItem): string {
  const title = (item.productType === 'room' ? joinParts([item.propertyName, item.productName]) : item.productName) || (item.productType === 'room' ? 'Phòng khách sạn' : 'Vé máy bay');
  const description = describeItem(item);
  const detail = description.startsWith(`${title} · `) ? description.slice(title.length + 3) : description;
  const isRoom = item.productType === 'room';
  return `<tr><td style="padding:18px 0;border-bottom:1px solid #E2E8F0">
    <span style="display:inline-block;padding:4px 10px;border-radius:6px;background:${isRoom ? '#FFF0EB' : '#D9F4F1'};color:${isRoom ? '#BC331E' : '#006C63'};font-size:12px;font-weight:700">${isRoom ? 'Khách sạn' : 'Vé máy bay'}</span>
    <p style="margin:10px 0 4px;font-size:16px;font-weight:700">${escapeHtml(title)}</p>
    <p style="margin:0;color:#64748B;font-size:14px">${escapeHtml(detail)}</p>
  </td></tr>`;
}

/** Email xác nhận đặt chỗ gửi tới email khách nhập khi đặt, kèm link mở lại đơn trên web. */
export function buildOrderConfirmationEmail(payload: CommerceOrderPaidV1, email: string, webAppUrl: string): EmailMessage {
  const greeting = payload.contactName ? `Chào ${payload.contactName},` : 'Chào bạn,';
  const codeLine = payload.confirmationCode ? `Mã xác nhận: ${payload.confirmationCode}` : `Mã đơn: ${payload.orderId}`;
  const items = payload.items.map(describeItem);
  const guests = (payload.guests ?? []).map((guest) => (guest.passengerType ? `${guest.fullName} (${PASSENGER_LABELS[guest.passengerType]})` : guest.fullName));
  const guestLines = guests.length ? ['', 'Hành khách:', ...guests.map((guest) => `- ${guest}`)] : [];
  const contactRows = [
    { label: 'Người đặt', value: payload.contactName },
    { label: 'Số điện thoại', value: payload.contactPhone ? formatPhone(payload.contactPhone) : payload.contactPhone },
    { label: 'Email', value: payload.contactEmail },
  ].filter((row): row is { label: string; value: string } => Boolean(row.value));
  const contactLines = contactRows.length ? ['', 'Thông tin liên hệ:', ...contactRows.map(({ label, value }) => `- ${label}: ${value}`)] : [];
  const totalLine = `Tổng thanh toán: ${formatMoney(payload.total)}`;
  const orderUrl = `${webAppUrl.replace(/\/+$/, '')}/checkout/${encodeURIComponent(payload.orderId)}`;
  return {
    to: email,
    subject: payload.confirmationCode ? `Xác nhận đặt chỗ Tripflix ${payload.confirmationCode}` : 'Xác nhận đặt chỗ Tripflix',
    text: [greeting, '', 'Đơn đặt chỗ của bạn đã được thanh toán thành công.', codeLine, '', ...items.map((item) => `- ${item}`), ...guestLines, ...contactLines, '', totalLine, '', `Xem đơn: ${orderUrl}`, '', 'Tripflix · Chạm cảm hứng, trọn hành trình.'].join('\n'),
    html: [
      '<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0;background:#FFF7F2">',
      // Bảng và style nội tuyến giúp email hiển thị ổn định trên nhiều ứng dụng.
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FFF7F2;font-family:\'Be Vietnam Pro\',Segoe UI,Arial,sans-serif;color:#18242B;line-height:1.7"><tr><td align="center" style="padding:28px 12px">',
      '<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;table-layout:fixed;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:16px">',
      '<tr><td style="padding:28px 24px 22px;border-bottom:1px solid #E2E8F0"><p style="margin:0;color:#FF5A3C;font-size:32px;font-weight:800">Tripflix</p><p style="margin:4px 0 0;color:#64748B;font-size:12px">Chạm cảm hứng, trọn hành trình.</p></td></tr>',
      '<tr><td style="padding:28px 24px 0;overflow-wrap:anywhere;word-wrap:break-word">',
      '<span style="display:inline-block;background:#D9F4F1;color:#006C63;padding:6px 12px;border-radius:20px;font-size:13px;font-weight:700">✓ Đã thanh toán</span>',
      '<h1 style="margin:16px 0 12px;font-size:26px;line-height:1.3">Đặt chỗ thành công</h1>',
      `<p style="margin:0 0 8px;font-size:15px">${escapeHtml(greeting)}</p>`,
      '<p style="margin:0 0 24px;color:#64748B;font-size:14px">Đơn đặt chỗ của bạn đã được thanh toán thành công.</p>',
      `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px dashed #FF5A3C;border-radius:12px;background:#FFF0EB"><tr><td align="center" style="padding:18px 12px"><p style="margin:0 0 6px;font-size:12px;color:#64748B">${payload.confirmationCode ? 'Mã xác nhận' : 'Mã đơn'}</p><p style="margin:0;font-size:24px;font-weight:800;letter-spacing:2px;word-break:break-all">${escapeHtml(payload.confirmationCode || payload.orderId)}</p></td></tr></table>`,
      `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${payload.items.map(renderOrderItem).join('')}</table>`,
      ...((payload.guests ?? []).length ? ['<p style="margin:22px 0 8px;font-size:14px;font-weight:700">Hành khách</p>', `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${payload.guests!.map((guest) => `<tr><td style="padding:3px 0;color:#64748B;font-size:13px">${escapeHtml(joinParts([guest.fullName, guest.passengerType ? PASSENGER_LABELS[guest.passengerType] : null]))}</td></tr>`).join('')}</table>`] : []),
      ...(contactRows.length ? [`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:24px;border:1px solid #E2E8F0;border-radius:12px"><tr><td style="padding:16px"><p style="margin:0 0 8px;font-size:14px;font-weight:700">Thông tin liên hệ</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${contactRows.map(({ label, value }) => `<tr><td style="padding:3px 12px 3px 0;color:#64748B;font-size:13px;vertical-align:top">${escapeHtml(label)}</td><td style="padding:3px 0;font-size:13px;overflow-wrap:anywhere;word-wrap:break-word">${escapeHtml(value)}</td></tr>`).join('')}</table></td></tr></table>`] : []),
      `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:24px;border-top:1px solid #E2E8F0"><tr><td style="padding:20px 8px 0 0;font-size:14px;font-weight:700">Tổng thanh toán</td><td align="right" style="padding:20px 0 0;font-size:20px;font-weight:800">${escapeHtml(formatMoney(payload.total))}</td></tr></table>`,
      `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 28px"><tr><td align="center" bgcolor="#BC331E" style="border-radius:12px"><a href="${escapeHtml(orderUrl)}" style="display:inline-block;background:#BC331E;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:700;padding:13px 24px;border-radius:12px">Xem đơn đặt chỗ</a></td></tr></table>`,
      '</td></tr><tr><td style="padding:20px 24px;border-top:1px solid #E2E8F0"><p style="margin:0 0 4px;color:#64748B;font-size:12px">Email này được gửi tự động, vui lòng không trả lời.</p><p style="margin:0;color:#64748B;font-size:12px">Chạm cảm hứng, trọn hành trình.</p></td></tr>',
      '</table></td></tr></table></body></html>',
    ].join('\n'),
  };
}
