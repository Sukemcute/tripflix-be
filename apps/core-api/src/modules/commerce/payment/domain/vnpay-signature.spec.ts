import { createHmac } from 'node:crypto';
import { buildSignData, buildSignedUrl, buildVnpayTxnRef, formatVnpayDate, isValidSignature, isVnpaySuccess } from './vnpay-signature.js';

const hmac = (secret: string, data: string) => createHmac('sha512', secret).update(Buffer.from(data, 'utf8')).digest('hex');

describe('vnpay-signature', () => {
  const params = { vnp_TxnRef: 'ABC01', vnp_Amount: '100000', vnp_OrderInfo: 'Thanh toan don ABC', vnp_Command: 'pay', vnp_SecureHash: 'x' };

  it('chuỗi ký: sắp theo tên, bỏ vnp_SecureHash, dấu cách thành +', () => {
    expect(buildSignData(params)).toBe('vnp_Amount=100000&vnp_Command=pay&vnp_OrderInfo=Thanh+toan+don+ABC&vnp_TxnRef=ABC01');
  });

  it('URL đã ký kiểm lại được; sửa một tham số thì chữ ký sai', () => {
    const url = buildSignedUrl('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html', { ...params, vnp_SecureHash: '' }, 'SECRET', hmac);
    const back = Object.fromEntries(new URL(url).searchParams);
    expect(isValidSignature(back, 'SECRET', hmac)).toBe(true);
    expect(isValidSignature({ ...back, vnp_Amount: '200000' }, 'SECRET', hmac)).toBe(false);
    expect(isValidSignature({ ...back, vnp_SecureHash: undefined as unknown as string }, 'SECRET', hmac)).toBe(false);
  });

  it('ngày theo giờ Việt Nam; mã đơn chỉ chữ số; thành công cần cả hai mã 00', () => {
    expect(formatVnpayDate(new Date('2026-11-05T03:04:05Z'))).toBe('20261105100405');
    expect(buildVnpayTxnRef('a1b2c3d4-0000-4000-8000-000000000001', 3)).toMatch(/^[a-z0-9]+03$/);
    expect(isVnpaySuccess({ vnp_ResponseCode: '00', vnp_TransactionStatus: '00' })).toBe(true);
    expect(isVnpaySuccess({ vnp_ResponseCode: '24', vnp_TransactionStatus: '02' })).toBe(false);
  });
});
