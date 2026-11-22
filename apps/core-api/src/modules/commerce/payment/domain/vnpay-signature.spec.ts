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

  it('chấp nhận chữ ký HMAC-SHA512 đúng ở dạng chữ thường và chữ hoa', () => {
    const signature = hmac('SECRET', buildSignData(params));
    expect(isValidSignature({ ...params, vnp_SecureHash: signature }, 'SECRET', hmac)).toBe(true);
    expect(isValidSignature({ ...params, vnp_SecureHash: signature.toUpperCase() }, 'SECRET', hmac)).toBe(true);
  });

  it.each(['first', 'last'] as const)('từ chối chữ ký sai cùng độ dài ở vị trí %s', (position) => {
    const signature = hmac('SECRET', buildSignData(params));
    const index = position === 'first' ? 0 : signature.length - 1;
    const replacement = signature[index] === '0' ? '1' : '0';
    const invalid = signature.slice(0, index) + replacement + signature.slice(index + 1);
    expect(isValidSignature({ ...params, vnp_SecureHash: invalid }, 'SECRET', hmac)).toBe(false);
  });

  it.each([
    ['ngắn hơn', (signature: string) => signature.slice(0, -2)],
    ['dài hơn', (signature: string) => `${signature}00`],
    ['độ dài lẻ', (signature: string) => signature.slice(0, -1)],
    ['không phải hex', (signature: string) => `${signature.slice(0, -1)}g`],
    ['hậu tố không phải hex', (signature: string) => `${signature}zz`],
    ['rỗng', () => ''],
    ['thiếu', () => undefined as unknown as string],
  ])('chữ ký %s trả false và không throw', (_label, makeInvalid) => {
    const signature = hmac('SECRET', buildSignData(params));
    expect(isValidSignature({ ...params, vnp_SecureHash: makeInvalid(signature) }, 'SECRET', hmac)).toBe(false);
  });
});
