import type { CommerceOrderPaidV1 } from '@tripflix/contracts';
import { buildOrderConfirmationEmail } from './order-confirmation.email.js';

const payload: CommerceOrderPaidV1 = {
  orderId: '26a51c0a-bb44-4fea-8bac-863f860ac044',
  userId: '26a51c0a-bb44-4fea-8bac-863f860ac045',
  sourcePostId: null,
  confirmationCode: 'TF-8K2Q9M',
  contactName: 'An <b>',
  total: 6480000,
  items: [
    { productType: 'room', productId: 'room-1', date: '2026-12-01', nights: 2, qty: 1, propertyName: 'Khách sạn <Biển>', productName: 'Phòng tiêu chuẩn', ratePlanName: 'Ăn sáng & nghỉ dưỡng' },
    { productType: 'flight', productId: 'flight-1', date: '2026-12-01', nights: 1, qty: 3, productName: 'VN1340 · Phổ thông', flight: { fromAirport: 'SGN', toAirport: 'CXR', departTime: '07:05:00', arriveTime: '08:15:00' } },
  ],
  guests: [{ fullName: 'An <b>', passengerType: 'adult' }, { fullName: 'Bé Na', passengerType: 'child' }, { fullName: 'Bé Mi', passengerType: 'infant' }],
};

describe('buildOrderConfirmationEmail', () => {
  it('hiển thị thương hiệu, trạng thái, mã xác nhận, tổng tiền và nút mở đơn', () => {
    const mail = buildOrderConfirmationEmail(payload, 'an@example.com', 'https://tripflix.vn/');
    expect(mail.html).toContain('✓ Đã thanh toán');
    expect(mail.html).toContain('Đặt chỗ thành công');
    expect(mail.html).toContain('border:1px dashed #FF5A3C');
    expect(mail.html).toContain('Mã xác nhận');
    expect(mail.html).toContain('TF-8K2Q9M');
    expect(mail.html).toContain(`href="https://tripflix.vn/checkout/${payload.orderId}"`);
    expect(mail.html).toContain('Xem đơn đặt chỗ');
    expect(mail.html).toContain('Tổng thanh toán');
    expect(mail.html).toContain('6.480.000đ');
    expect(mail.html).toContain('max-width:600px');
    expect(mail.html).toContain('Khách sạn</span>');
    expect(mail.html).toContain('Vé máy bay</span>');
    expect(mail.html).toContain('SGN → CXR · 01/12/2026 · 07:05–08:15 · 3 ghế');
    expect(mail.html).toContain('An &lt;b&gt; · Người lớn');
    expect(mail.html).toContain('Bé Na · Trẻ em');
    expect(mail.html).toContain('Bé Mi · Em bé');
    expect(mail.subject).toBe('Xác nhận đặt chỗ Tripflix TF-8K2Q9M');
  });

  it('thoát dữ liệu động trong nội dung và thuộc tính liên kết', () => {
    const mail = buildOrderConfirmationEmail({ ...payload, confirmationCode: 'TF-<code>"&' }, 'an@example.com', 'https://tripflix.vn/?a="&b=');
    expect(mail.html).toContain('An &lt;b&gt;');
    expect(mail.html).toContain('Khách sạn &lt;Biển&gt;');
    expect(mail.html).toContain('Ăn sáng &amp; nghỉ dưỡng');
    expect(mail.html).toContain('TF-&lt;code&gt;&quot;&amp;');
    expect(mail.html).toContain('href="https://tripflix.vn/?a=&quot;&amp;b=/checkout/');
    expect(mail.html).not.toContain('An <b>');
    expect(mail.html).not.toContain('Khách sạn <Biển>');
  });

  it('dùng mã đơn khi thiếu mã xác nhận và ẩn hành khách khi không có', () => {
    const mail = buildOrderConfirmationEmail({ ...payload, confirmationCode: null, guests: undefined }, 'an@example.com', 'https://tripflix.vn');
    expect(mail.html).toContain('Mã đơn');
    expect(mail.html).toContain(payload.orderId);
    expect(mail.html).not.toContain('Hành khách');
    expect(mail.subject).toBe('Xác nhận đặt chỗ Tripflix');
  });

  it('hiển thị liên hệ sau hành khách, trước tổng tiền và định dạng số điện thoại', () => {
    const mail = buildOrderConfirmationEmail({ ...payload, contactName: 'Nguyễn An', contactPhone: '0901234567', contactEmail: 'booker@example.com' }, 'recipient@example.com', 'https://tripflix.vn');
    const contactIndex = mail.html.indexOf('Thông tin liên hệ');
    const totalIndex = mail.html.indexOf('Tổng thanh toán');
    const contactHtml = mail.html.slice(contactIndex, totalIndex);

    expect(contactIndex).toBeGreaterThan(mail.html.indexOf('Bé Mi · Em bé'));
    expect(totalIndex).toBeGreaterThan(contactIndex);
    expect(contactHtml).toContain('Người đặt');
    expect(contactHtml).toContain('>Nguyễn An</td>');
    expect(contactHtml).toContain('Số điện thoại');
    expect(contactHtml).toContain('>0901 234 567</td>');
    expect(contactHtml).toContain('Email');
    expect(contactHtml).toContain('>booker@example.com</td>');
    expect(contactHtml).not.toContain('recipient@example.com');
    expect(mail.to).toBe('recipient@example.com');
    expect(mail.text).toContain('- Bé Mi (Em bé)\n\nThông tin liên hệ:\n- Người đặt: Nguyễn An\n- Số điện thoại: 0901 234 567\n- Email: booker@example.com\n\nTổng thanh toán: 6.480.000đ');
  });

  it('thoát mọi giá trị liên hệ trong HTML và giữ nguyên chúng trong văn bản', () => {
    const contactName = `An <b title="x">O'Neil &</b>`;
    const contactPhone = `<img src="x" onerror='x'>&`;
    const contactEmail = `<email title="x">'&@example.com`;
    const mail = buildOrderConfirmationEmail({ ...payload, contactName, contactPhone, contactEmail }, 'an@example.com', 'https://tripflix.vn');
    const contactHtml = mail.html.slice(mail.html.indexOf('Thông tin liên hệ'), mail.html.indexOf('Tổng thanh toán'));

    expect(contactHtml).toContain('An &lt;b title=&quot;x&quot;&gt;O&#39;Neil &amp;&lt;/b&gt;');
    expect(contactHtml).toContain('&lt;img src=&quot;x&quot; onerror=&#39;x&#39;&gt;&amp;');
    expect(contactHtml).toContain('&lt;email title=&quot;x&quot;&gt;&#39;&amp;@example.com');
    expect(contactHtml).not.toContain(contactName);
    expect(contactHtml).not.toContain(contactPhone);
    expect(contactHtml).not.toContain(contactEmail);
    expect(mail.text).toContain(`Thông tin liên hệ:\n- Người đặt: ${contactName}\n- Số điện thoại: ${contactPhone}\n- Email: ${contactEmail}`);
  });

  it.each([undefined, null, ''])('ẩn dòng điện thoại khi giá trị là %s', (contactPhone) => {
    const mail = buildOrderConfirmationEmail({ ...payload, contactPhone, contactEmail: 'an@example.com' }, 'an@example.com', 'https://tripflix.vn');
    const contactHtml = mail.html.slice(mail.html.indexOf('Thông tin liên hệ'), mail.html.indexOf('Tổng thanh toán'));

    expect(contactHtml).toContain('Người đặt');
    expect(contactHtml).toContain('An &lt;b&gt;');
    expect(contactHtml).toContain('Email');
    expect(contactHtml).toContain('an@example.com');
    expect(mail.html).not.toContain('Số điện thoại');
    expect(mail.text).not.toContain('Số điện thoại');
    expect(mail.text).toContain('Thông tin liên hệ:\n- Người đặt: An <b>\n- Email: an@example.com');
  });

  it.each(['+84901234567', '0901 234 567', '123456789', '0901234567\n'])('giữ nguyên số điện thoại không gồm đúng 10 chữ số: %s', (contactPhone) => {
    const mail = buildOrderConfirmationEmail({ ...payload, contactName: undefined, contactPhone, contactEmail: undefined }, 'an@example.com', 'https://tripflix.vn');
    const contactHtml = mail.html.slice(mail.html.indexOf('Thông tin liên hệ'), mail.html.indexOf('Tổng thanh toán'));

    expect(contactHtml).toContain(`>${contactPhone}</td>`);
    expect(contactHtml).not.toContain('Người đặt');
    expect(contactHtml).not.toContain('Email');
    expect(mail.text).toContain(`Thông tin liên hệ:\n- Số điện thoại: ${contactPhone}\n\nTổng thanh toán:`);
    expect(mail.text).not.toContain('- Người đặt:');
    expect(mail.text).not.toContain('- Email:');
  });

  it.each([undefined, null, ''])('ẩn mục liên hệ khi tất cả giá trị là %s', (contactValue) => {
    const mail = buildOrderConfirmationEmail({ ...payload, contactName: contactValue, contactPhone: contactValue, contactEmail: contactValue }, 'recipient@example.com', 'https://tripflix.vn');

    expect(mail.html).not.toContain('Thông tin liên hệ');
    expect(mail.text).not.toContain('Thông tin liên hệ');
    expect(mail.html).not.toContain('recipient@example.com');
    expect(mail.text).not.toContain('recipient@example.com');
    expect(mail.text).toContain('- Bé Mi (Em bé)\n\nTổng thanh toán: 6.480.000đ');
  });
});
