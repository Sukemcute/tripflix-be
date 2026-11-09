import { describe, expect, it } from 'vitest';
import { evaluateRules } from './rules.js';
import { evaluateSeverity } from './severity.js';

describe('Luật kiểm duyệt tiếng Việt', () => {
  it.each([
    '0912 345 678',
    '+84.912.345.678',
    '84912345678',
    'zalo 09l2345678',
    '0987-654-321',
    'không chín một hai ba bốn năm sáu bảy tám',
  ])('nhận SĐT %s', (text) => {
    expect(evaluateRules(text).some((hit) => hit.code === 'PHONE_VN')).toBe(true);
  });
  it.each([
    'bit.ly/abc',
    't.me/tour',
    'zalo.me/0912345678',
    'tour-gia-re . com',
    'tour cham com',
    'https://evil.com',
    'www.tour.net',
  ])('nhận link %s', (text) => {
    expect(evaluateRules(text).some((hit) => hit.code === 'LINK')).toBe(true);
  });
  it.each(['STK 0123456789 VCB', 'số tài khoản 123456789012', 'Vietcombank 1234567890'])(
    'nhận STK %s',
    (text) => {
      expect(evaluateRules(text).some((hit) => hit.code === 'BANK_ACCOUNT')).toBe(true);
    },
  );
  it.each([
    '1.500.000đ',
    'Năm 2026',
    'Phòng 304',
    'Cảnh đẹp quá',
    'Đường lên núi',
    '5 người 3 ngày',
    'Món ngon',
    'Chuyến đi tuyệt vời',
    'Cọc trước cho khách sạn trên app',
    '12345678901234567890',
  ])('không tự ẩn mẫu sạch %s', (text) => {
    expect(
      evaluateSeverity(evaluateRules(text), null, 0, { aiThreshold: 0.8, reportThreshold: 3 }).shouldAutoHide,
    ).toBe(false);
  });
  it.each([
    'vinpearl.com',
    'https://www.vinpearl.com/tour',
    'https://maps.google.com/a',
    'https://tripflix.vn',
  ])('bỏ qua whitelist chính xác %s', (text) => {
    expect(
      evaluateRules(text, ['vinpearl.com', 'maps.google.com', 'tripflix.vn']).some(
        (hit) => hit.code === 'LINK',
      ),
    ).toBe(false);
  });
  it('tên miền giống whitelist vẫn bị nhận', () => {
    expect(
      evaluateRules('https://vinpearl.com.evil.com', ['vinpearl.com']).some((hit) => hit.code === 'LINK'),
    ).toBe(true);
  });
  it('STK + lời mời chuyển tiền mới tự ẩn; phone/link đơn lẻ chỉ vào hàng chờ', () => {
    const config = { aiThreshold: 0.8, reportThreshold: 3 };
    expect(
      evaluateSeverity(evaluateRules('chuyển khoản đặt cọc STK 123456789012'), null, 0, config)
        .shouldAutoHide,
    ).toBe(true);
    expect(evaluateSeverity(evaluateRules('0912345678 bit.ly/tour'), null, 0, config)).toMatchObject({
      suspicious: true,
      shouldAutoHide: false,
    });
  });
});
describe('Ngưỡng severity', () => {
  const config = { aiThreshold: 0.8, reportThreshold: 3 };
  it('giữ nguyên nhãn slash, chỉ tự ẩn nhóm nguy hiểm đủ điểm và flagged', () => {
    const ai = {
      id: 'x',
      model: 'omni',
      flagged: true,
      categories: { 'self-harm/intent': true },
      scores: { 'self-harm/intent': 0.9 },
    };
    expect(evaluateSeverity([], ai, 0, config).shouldAutoHide).toBe(true);
    expect(evaluateSeverity([], { ...ai, flagged: false }, 0, config).shouldAutoHide).toBe(false);
    expect(
      evaluateSeverity([], { ...ai, scores: { 'self-harm/intent': 0.79 } }, 0, config).shouldAutoHide,
    ).toBe(false);
  });
  it('đủ 3 báo cáo mới tự ẩn', () => {
    expect(evaluateSeverity([], null, 2, config).shouldAutoHide).toBe(false);
    expect(evaluateSeverity([], null, 3, config).shouldAutoHide).toBe(true);
  });
});
