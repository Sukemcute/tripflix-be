import type { CommerceOrderDepartureReminderV1 } from '@tripflix/contracts';
import { escapeHtml } from './html.js';
import type { EmailMessage } from './mailer.js';

type ReminderItem = CommerceOrderDepartureReminderV1['items'][number];

const VIETNAM_TIME_FORMAT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', day: '2-digit', month: '2-digit', year: 'numeric' });

/** "14:00 01/12/2026" theo giờ Việt Nam; tự ghép để không phụ thuộc dấu phân cách của ICU từng máy. */
export function formatVietnamTime(iso: string, options: { hasYear: boolean } = { hasYear: true }): string {
  const parts = Object.fromEntries(VIETNAM_TIME_FORMAT.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.hour}:${parts.minute} ${parts.day}/${parts.month}${options.hasYear ? `/${parts.year}` : ''}`;
}
const formatDate = (isoDate: string) => isoDate.slice(0, 10).split('-').reverse().join('/');

function describeItem(item: ReminderItem): string {
  if (item.productType === 'room') return [item.propertyName, item.productName, `nhận phòng ${formatDate(item.date)}`, `${item.nights} đêm`].filter(Boolean).join(' · ');
  const route = item.flight ? `${item.flight.fromAirport} → ${item.flight.toAirport}` : null;
  return [item.productName, route, formatDate(item.date), item.flight?.departTime?.slice(0, 5)].filter(Boolean).join(' · ');
}

/** TF37: nhắc khách 24 giờ trước chuyến; giờ hiển thị theo giờ Việt Nam. */
export function buildDepartureReminderEmail(payload: CommerceOrderDepartureReminderV1, email: string, webAppUrl: string): EmailMessage {
  const greeting = payload.contactName ? `Chào ${payload.contactName},` : 'Chào bạn,';
  const startText = formatVietnamTime(payload.startAt);
  const code = payload.confirmationCode || payload.orderId;
  const orderUrl = `${webAppUrl.replace(/\/+$/, '')}/checkout/${encodeURIComponent(payload.orderId)}`;
  const items = payload.items.map(describeItem);
  return {
    to: email,
    subject: `Chuyến đi của bạn bắt đầu lúc ${startText}`,
    text: [greeting, '', `Chuyến đi của bạn sắp bắt đầu lúc ${startText}.`, `Mã xác nhận: ${code}`, '', ...items.map((item) => `- ${item}`), '', `Xem đơn: ${orderUrl}`, '', 'Tripflix · Chạm cảm hứng, trọn hành trình.'].join('\n'),
    html: [
      '<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0;background:#FFF7F2">',
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FFF7F2;font-family:\'Be Vietnam Pro\',Segoe UI,Arial,sans-serif;color:#18242B;line-height:1.7"><tr><td align="center" style="padding:28px 12px">',
      '<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:16px">',
      '<tr><td style="padding:28px 24px 22px;border-bottom:1px solid #E2E8F0"><p style="margin:0;color:#FF5A3C;font-size:32px;font-weight:800">Tripflix</p></td></tr>',
      '<tr><td style="padding:28px 24px;overflow-wrap:anywhere">',
      '<h1 style="margin:0 0 12px;font-size:24px;line-height:1.3">Chuyến đi sắp bắt đầu</h1>',
      `<p style="margin:0 0 8px;font-size:15px">${escapeHtml(greeting)}</p>`,
      `<p style="margin:0 0 16px;font-size:14px">Chuyến đi của bạn bắt đầu lúc <b>${escapeHtml(startText)}</b>. Mã xác nhận: <b>${escapeHtml(code)}</b>.</p>`,
      `<ul style="margin:0 0 24px;padding-left:20px;color:#64748B;font-size:14px">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`,
      `<a href="${escapeHtml(orderUrl)}" style="display:inline-block;background:#BC331E;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:700;padding:13px 24px;border-radius:12px">Xem đơn đặt chỗ</a>`,
      '</td></tr><tr><td style="padding:20px 24px;border-top:1px solid #E2E8F0"><p style="margin:0;color:#64748B;font-size:12px">Email này được gửi tự động, vui lòng không trả lời.</p></td></tr>',
      '</table></td></tr></table></body></html>',
    ].join('\n'),
  };
}
