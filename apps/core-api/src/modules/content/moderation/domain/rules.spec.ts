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
    'vcc thằng ngu, nói mãi vẫn không hiểu',
    'đm mày',
    'dcm chủ homestay',
    'bọn nhà quê ngu dốt mới đi chỗ này',
    'thằng chó chủ resort',
    'mặt như lồn',
    'địt mẹ lừa khách',
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
    'VKL, dịch vụ gì mà thế',
    'clgt vậy trời',
    'Vcl!',
    'vkl',
    'vcc',
    'clgt',
    'Bình minh trên đồi cỏ tím đỉnh vcl, đáng công dậy từ bốn giờ.',
    'Ông tài xế tìm quán ăn trưa chất vcl, vừa ngon vừa có chỗ đỗ.',
    'Nhạc acoustic tối thứ bảy cuốn vkl, ngồi nghe quên giờ về.',
    'Con đường xe đạp ven đầm xịn vcc, mặt đường phẳng dễ chạy.',
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

  it('xúc phạm và đe doạ tự ẩn với lý do đúng (TF88)', () => {
    const threat = evaluateSeverity(evaluateRules('tao giết mày'), null, 0, config);
    const profanity = evaluateSeverity(evaluateRules('vcl ad óc chó'), null, 0, config);
    expect(threat).toMatchObject({ suspicious: true, shouldAutoHide: true, autoHideReason: 'VIOLENCE' });
    expect(profanity).toMatchObject({
      suspicious: true,
      shouldAutoHide: true,
      autoHideReason: 'HARASSMENT',
    });
  });

  it.each([
    'đồ con chó',
    'mày là con chó',
    'địt cụ nhà mày',
    'đéo mẹ cái homestay này',
    'đụ mẹ',
    'mẹ kiếp mày',
  ])('nhận xúc phạm bổ sung (TF88): %s', (text) => {
    expect(codesOf(text)).toContain('PROFANITY');
  });

  it.each([
    'nhà có con chó dễ thương lắm',
    'đó là con chó của chủ nhà',
    'bốn con chó chạy trên bãi biển',
    'mua hạt óc chó làm quà',
    'sữa óc chó ở đây ngon',
    'bánh óc chó nướng',
    'thằng bé chơi với con chó cả buổi',
  ])('không ẩn nhầm con vật, món ăn (TF88): %s', (text) => {
    expect(codesOf(text)).not.toContain('PROFANITY');
    expect(evaluateSeverity(evaluateRules(text), null, 0, config).shouldAutoHide).toBe(false);
  });
});
describe('Luật nội dung phản động (TF88)', () => {
  const config = { aiThreshold: 0.8, reportThreshold: 3 };
  const codesOf = (text: string) => evaluateRules(text).map((hit) => hit.code);

  it.each([
    'Đả đảo cộng sản',
    'đã đến lúc lật đổ chế độ',
    'anh em hãy cùng lật đổ chính quyền',
    'giải thể Đảng Cộng sản đi',
    'mọi người nên ủng hộ Việt Tân',
    'nhà nước Đề Ga muôn năm',
    'đòi độc lập Tây Nguyên',
    'Hoàng Sa là của Trung Quốc',
    'Trường Sa thuộc về Trung Quốc',
    'chính quyền ăn cướp đất dân',
    'chế độ độc tài thối nát',
    'cộng sản khốn nạn',
    'hồ tặc',
  ])('nhận và tự ẩn: %s', (text) => {
    expect(codesOf(text)).toContain('EXTREMISM');
    expect(evaluateSeverity(evaluateRules(text), null, 0, config)).toMatchObject({
      shouldAutoHide: true,
      autoHideReason: 'EXTREMISM',
    });
  });

  it.each([
    'Hoàng Sa, Trường Sa là của Việt Nam',
    'tham quan bảo tàng Hồ Chí Minh rất đẹp',
    'đi viếng lăng Bác buổi sáng',
    'chuyến đi lật đổ mọi định kiến của mình về Tây Bắc',
    'cà phê Tây Nguyên ngon nhất',
    'khu di tích Đảng bộ tỉnh mở cửa miễn phí',
    'đã đảo một vòng quanh hồ',
    'lịch sử chiến tranh Việt Nam ở bảo tàng rất xúc động',
    'Việt Tân là tên quán cơm gần khách sạn',
  ])('không bắt nhầm: %s', (text) => {
    expect(codesOf(text)).not.toContain('EXTREMISM');
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
  it('AI gắn cờ xúc phạm, thù ghét hoặc ViSoBERT toxic thì tự ẩn (TF88)', () => {
    const base = { id: 'x', model: 'omni+visobert', flagged: true };
    expect(
      evaluateSeverity(
        [],
        { ...base, categories: { harassment: true }, scores: { harassment: 0.85 } },
        0,
        config,
      ),
    ).toMatchObject({ shouldAutoHide: true, autoHideReason: 'HARASSMENT' });
    expect(
      evaluateSeverity([], { ...base, categories: { hate: true }, scores: { hate: 0.9 } }, 0, config)
        .autoHideReason,
    ).toBe('HARASSMENT');
    expect(
      evaluateSeverity(
        [],
        {
          ...base,
          categories: { 'visobert/toxic': true },
          scores: { 'visobert/offensive': 0.6, 'visobert/hate': 0.39 },
        },
        0,
        config,
      ),
    ).toMatchObject({ shouldAutoHide: true, autoHideReason: 'HARASSMENT' });
    expect(
      evaluateSeverity(
        [],
        { ...base, categories: { harassment: true }, scores: { harassment: 0.5 } },
        0,
        config,
      ).shouldAutoHide,
    ).toBe(false);
    expect(
      evaluateSeverity(
        [],
        { ...base, flagged: false, categories: { 'visobert/toxic': false }, scores: {} },
        0,
        config,
      ).shouldAutoHide,
    ).toBe(false);
  });
  it('lý do tự ẩn theo nhãn AI nguy hiểm nhất', () => {
    const ai = {
      id: 'x',
      model: 'omni',
      flagged: true,
      categories: { sexual: true, harassment: true },
      scores: { sexual: 0.95, harassment: 0.9 },
    };
    expect(evaluateSeverity([], ai, 0, config).autoHideReason).toBe('SEXUAL');
  });
  it('báo cáo tăng ưu tiên nhưng không tự ẩn nếu không có bằng chứng khác', () => {
    expect(evaluateSeverity([], null, 2, config).shouldAutoHide).toBe(false);
    expect(evaluateSeverity([], null, 3, config)).toMatchObject({
      suspicious: true,
      severity: 45,
      shouldAutoHide: false,
    });
    expect(evaluateSeverity([], null, 20, config).shouldAutoHide).toBe(false);
  });
});
