import { describe, expect, it } from 'vitest';
import { buildDisplayName, normalizeEmail } from './credentials.js';
import { hasControlChars, hasVisibleChar, stripControlChars } from './text-rules.js';

const ch = (code: number) => String.fromCodePoint(code);

describe('TF05C: text-rules', () => {
  it('hasVisibleChar: chữ, số, dấu, emoji là nhìn thấy; khoảng trắng và ký tự định dạng thì không', () => {
    for (const v of ['a', '1', '.', 'Đ', ch(0x1f600), ` ${ch(0x200b)}x`])
      expect(hasVisibleChar(v), JSON.stringify(v)).toBe(true);
    for (const v of [
      '',
      ' ',
      '\t\n\r',
      ch(0xa0),
      ch(0x200b),
      ch(0x200c),
      ch(0x200d),
      ch(0xfeff),
      ch(0x2060),
      ch(0x200e),
      ch(0x3000),
      ch(0x3164),
      ch(0x115f),
      ch(0xffa0),
    ]) {
      expect(hasVisibleChar(v), `U+${v.codePointAt(0)?.toString(16)}`).toBe(false);
    }
  });

  it('hasControlChars: xuống dòng, tab, NUL, DEL, ngắt dòng Unicode', () => {
    for (const v of [
      'a\nb',
      'a\rb',
      'a\tb',
      `a${ch(0)}`,
      `a${ch(0x7f)}`,
      `a${ch(0x85)}`,
      `a${ch(0x2028)}`,
      `a${ch(0x2029)}`,
    ]) {
      expect(hasControlChars(v), JSON.stringify(v)).toBe(true);
    }
    for (const v of ['Nguyễn Văn A', 'a b', ch(0x1f600), `a${ch(0x200d)}b`])
      expect(hasControlChars(v)).toBe(false);
  });

  it('stripControlChars: đổi ký tự điều khiển thành một dấu cách, gộp khoảng trắng, cắt hai đầu', () => {
    expect(stripControlChars('  Pixel\n\n8\t Pro ')).toBe('Pixel 8 Pro');
    expect(stripControlChars(`A${ch(0)}${ch(0x1b)}B`)).toBe('A B');
    expect(stripControlChars('\n\t')).toBe('');
  });
});

describe('TF05C: credentials', () => {
  it('normalizeEmail: cắt khoảng trắng, chữ thường', () => {
    expect(normalizeEmail('  Lan.Nguyen@Example.COM \n')).toBe('lan.nguyen@example.com');
  });

  it('buildDisplayName: tên Google sạch thì giữ, bẩn thì làm sạch, không có thì lấy phần trước @', () => {
    expect(buildDisplayName('Lan Nguyễn', 'lan@example.com')).toBe('Lan Nguyễn');
    expect(buildDisplayName('  Lan\nNguyễn\t ', 'lan@example.com')).toBe('Lan Nguyễn');
    expect(buildDisplayName(`A${ch(0x0300)}nh`, 'x@example.com')).toBe('Ành');
    expect(buildDisplayName(null, 'lan.nguyen@example.com')).toBe('lan.nguyen');
    expect(buildDisplayName('   ', 'lan@example.com')).toBe('lan');
    expect(buildDisplayName(ch(0x200b), 'lan@example.com')).toBe('lan');
    expect(buildDisplayName(null, '@example.com')).toBe('Thành viên Tripflix');
  });

  it('buildDisplayName: cắt còn 30 ký tự, không cắt đôi emoji, không để dấu cách ở cuối', () => {
    expect(buildDisplayName('a'.repeat(80), 'x@y.z')).toBe('a'.repeat(30));
    const emoji = ch(0x1f600);
    expect(buildDisplayName(emoji.repeat(60), 'x@y.z')).toBe(emoji.repeat(30));
    expect(buildDisplayName(`${'a'.repeat(29)} b`, 'x@y.z')).toBe('a'.repeat(29));
  });
});
