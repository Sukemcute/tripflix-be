import { normalizeText } from './normalize-text.js';

describe('normalizeText', () => {
  it('bỏ dấu, đổi đ thành d, chữ thường', () => {
    expect(normalizeText('Đà Lạt')).toBe('da lat');
    expect(normalizeText('Thừa Thiên Huế')).toBe('thua thien hue');
    expect(normalizeText('KHÁNH HÒA')).toBe('khanh hoa');
  });

  it('bỏ ký tự lạ và gộp khoảng trắng', () => {
    expect(normalizeText('  TP.HCM -- Sài   Gòn!! ')).toBe('tp hcm sai gon');
    expect(normalizeText('Vân Đồn (Hạ Long)')).toBe('van don ha long');
  });

  it('chuỗi chỉ có ký tự lạ thành rỗng', () => {
    expect(normalizeText(' .,!? ')).toBe('');
  });
});
