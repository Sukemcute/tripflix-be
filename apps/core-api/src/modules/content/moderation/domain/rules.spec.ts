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
describe('Luật xúc phạm và đe doạ', () => {
  const config = { aiThreshold: 0.8, reportThreshold: 3 };
  const codesOf = (text: string) => evaluateRules(text).map((hit) => hit.code);

  it.each([
    'Mày ngu như bò, quay video kiểu này mà cũng đăng',
    'may ngu nhu bo, dang lam gi vay',
    'đm con này xấu mà cũng bày đặt review',
    'vcl ad óc chó, nội dung rác rưởi',
    'VKL, dịch vụ gì mà thế',
    'dcm chủ homestay',
    'bọn nhà quê ngu dốt mới đi chỗ này',
    'thằng chó chủ resort',
    'mặt như lồn',
    'địt mẹ lừa khách',
    'clgt vậy trời',
  ])('nhận xúc phạm: %s', (text) => {
    expect(codesOf(text)).toContain('PROFANITY');
  });

  it.each([
    'Tao biết nhà mày ở đâu rồi đấy, liệu hồn',
    'biết nhà em ở đâu rồi nhé',
    'tao se tim ra may va cho may biet tay',
    'cho mày biết tay',
    'con kia mà còn chê nữa tao đánh cho nhập viện',
    'đập cho gãy tay',
    'tao giết mày',
    'chém chết mày luôn',
  ])('nhận đe doạ: %s', (text) => {
    expect(codesOf(text)).toContain('THREAT');
  });

  it.each([
    'view đẹp chết mất, nhất định phải đi một lần',
    'buffet ngon xỉu, ăn no muốn té xỉu luôn =))',
    'phục vụ tệ, đồ ăn dở, giá thì chát, không quay lại',
    'lừa đảo khách hàng, quảng cáo một đằng làm một nẻo',
    'mình bị ngộ độc sau khi ăn hải sản ở đây',
    'bãi biển có sứa, bé nhà mình bị đốt sưng chân',
    'nóng muốn chết mà nhảy xuống hồ bơi là sướng',
    'đỉnh của chóp, đẹp vãi chưởng',
    'cho mình hỏi phòng có cho mang thú cưng không ạ',
    'giá vé cắt cổ thật sự, chém khách quá tay',
    'chết cười với ông hướng dẫn viên, vui tính xỉu',
    'đi ngủ sớm để mai dậy ngắm bình minh',
    'mang theo lon bia và máy ảnh',
    'cho mình biết tay nghề đầu bếp ở đây ra sao',
    'đeo kính bơi khi lặn',
    'ngủ ngon, nệm êm lắm',
  ])('không bắt nhầm câu sạch: %s', (text) => {
    expect(codesOf(text).filter((code) => code === 'PROFANITY' || code === 'THREAT')).toEqual([]);
  });

  it('đe doạ vào hàng chờ với mức cao hơn xúc phạm nhưng không tự ẩn một mình', () => {
    const threat = evaluateSeverity(evaluateRules('tao giết mày'), null, 0, config);
    const profanity = evaluateSeverity(evaluateRules('vcl ad óc chó'), null, 0, config);
    expect(threat).toMatchObject({ suspicious: true, shouldAutoHide: false });
    expect(profanity).toMatchObject({ suspicious: true, shouldAutoHide: false });
    expect(threat.severity).toBeGreaterThan(profanity.severity);
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
