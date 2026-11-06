import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ChangePasswordRequestSchema, UpdateProfileRequestSchema } from '../../account/api/dto.js';
import {
  ForgotPasswordRequestSchema,
  ResetPasswordRequestSchema,
} from '../../account/api/password-reset.controller.js';
import { ServiceTokenRequestSchema } from '../../service/api/service-token.controller.js';
import { GrantStaffRequestSchema, SearchUsersQuerySchema } from '../../staff/api/dto.js';
import {
  GoogleLoginRequestSchema,
  LoginRequestSchema,
  RefreshRequestSchema,
  RegisterRequestSchema,
} from './dto.js';
import { type FieldError, parseAccessInput } from './validation.js';

/**
 * TF05C: kiểm đầu vào của module access cho mọi trường, mọi trường hợp biên.
 * Ký tự đặc biệt viết bằng String.fromCodePoint để file test chỉ có ký tự in được.
 */
const ch = (code: number) => String.fromCodePoint(code);
const ZWSP = ch(0x200b); // zero-width space
const BOM = ch(0xfeff);
const NBSP = ch(0xa0);
const LINE_SEP = ch(0x2028);
const HANGUL_FILLER = ch(0x3164);
const EMOJI = ch(0x1f600);
const FAMILY = [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467].map(ch).join(''); // emoji gia đình nối bằng ZWJ
const DECOMPOSED_A = `A${ch(0x0300)}`; // "À" viết rời (macOS hay gửi kiểu này)

function ok<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = parseAccessInput(schema, value);
  if (!r.success) throw new Error(`Mong đợi hợp lệ, nhận lỗi: ${JSON.stringify(r.errors)}`);
  return r.data;
}

function errors<T extends z.ZodType>(schema: T, value: unknown): FieldError[] {
  const r = parseAccessInput(schema, value);
  if (r.success) throw new Error(`Mong đợi lỗi, nhận dữ liệu: ${JSON.stringify(r.data)}`);
  return r.errors;
}

/** Lỗi đúng một trường, trả câu lỗi của trường đó. */
function onlyError<T extends z.ZodType>(schema: T, value: unknown, field: string): string {
  const list = errors(schema, value);
  expect(list.map((e) => e.field)).toEqual([field]);
  return list[0]!.message;
}

const PASSWORD = 'mat-khau-an-toan';
const register = (patch: Record<string, unknown>) => ({
  email: 'lan@example.com',
  password: PASSWORD,
  displayName: 'Lan',
  registrationId: '9784c96c-801f-4d05-b8ee-a6284bcf1935',
  code: '48162357',
  ...patch,
});

describe('TF05C: câu lỗi chung (accessErrorMap)', () => {
  it('body không phải object: báo ở gốc, câu tiếng Việt', () => {
    for (const body of [null, undefined, 'chuoi', 42, [], true]) {
      expect(errors(RegisterRequestSchema, body)).toEqual([
        { field: '', message: 'Dữ liệu gửi lên phải là một đối tượng JSON' },
      ]);
    }
  });

  it('thiếu từng trường bắt buộc: "Thiếu trường này", báo đủ các trường', () => {
    expect(errors(RegisterRequestSchema, {})).toEqual([
      { field: 'email', message: 'Thiếu trường này' },
      { field: 'password', message: 'Thiếu trường này' },
      { field: 'displayName', message: 'Thiếu trường này' },
      { field: 'registrationId', message: 'Yêu cầu gửi mã xác thực email trước khi đăng ký' },
      { field: 'code', message: 'Thiếu trường này' },
    ]);
  });

  it('sai kiểu: số, boolean, mảng, object, null đều báo "Phải là chuỗi ký tự"', () => {
    for (const value of [123, true, ['a@x.com'], { a: 1 }, null]) {
      expect(onlyError(RegisterRequestSchema, register({ email: value }), 'email')).toBe(
        'Phải là chuỗi ký tự',
      );
    }
  });

  it('không câu lỗi nào còn là tiếng Anh mặc định của zod', () => {
    const samples: [z.ZodType, unknown][] = [
      [LoginRequestSchema, { email: '', password: '' }],
      [
        LoginRequestSchema,
        { email: 'x'.repeat(255), password: 'x'.repeat(129), deviceName: 'x'.repeat(101) },
      ],
      [RefreshRequestSchema, { refreshToken: '' }],
      [RefreshRequestSchema, { refreshToken: 5 }],
      [GoogleLoginRequestSchema, { idToken: '' }],
      [SearchUsersQuerySchema, { page: 'abc' }],
      [SearchUsersQuerySchema, { page: '1.5' }],
      [ServiceTokenRequestSchema, {}],
      [ServiceTokenRequestSchema, { clientId: '', clientSecret: '', audience: '' }],
      [UpdateProfileRequestSchema, { gender: 'x', phone: 1 }],
      [ResetPasswordRequestSchema, { token: 'x'.repeat(201), newPassword: 'x'.repeat(129) }],
    ];
    for (const [schema, value] of samples) {
      for (const e of errors(schema, value)) {
        expect(e.message, `${e.field}: ${e.message}`).not.toMatch(
          /Invalid|expected|Too (small|big)|received/i,
        );
      }
    }
  });
});

describe('TF05C: đăng ký (RegisterRequestSchema)', () => {
  describe('email', () => {
    it.each([
      ['lan@example.com', 'lan@example.com'],
      ['Lan.Nguyen+trip@Example.COM', 'Lan.Nguyen+trip@Example.COM'],
      ['  lan@example.com  ', 'lan@example.com'], // bug cũ: khoảng trắng hai đầu bị báo "Email không hợp lệ"
      ['\tlan@example.com\n', 'lan@example.com'],
      ['a@sub.example.vn', 'a@sub.example.vn'],
    ])('nhận %j → %j', (input, expected) => {
      expect(ok(RegisterRequestSchema, register({ email: input })).email).toBe(expected);
    });

    it.each([
      '',
      '   ',
      'lan',
      'lan@',
      '@example.com',
      'lan@example',
      'lan@@example.com',
      'lan..a@example.com',
      'lan @example.com',
      'lan@exa mple.com',
      'lan@.com',
    ])('từ chối %j: "Email không hợp lệ"', (input) => {
      expect(onlyError(RegisterRequestSchema, register({ email: input }), 'email')).toBe(
        'Email không hợp lệ',
      );
    });

    it('tối đa 254 ký tự: 254 nhận, 255 từ chối', () => {
      // Phần trước @ tối đa 64 ký tự, mỗi nhãn tên miền tối đa 63 ký tự: 64 + 1 + (63 + 1 + 63 + 1 + n + 4).
      const email = (lastLabel: number) =>
        `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(lastLabel)}.com`;
      expect(email(57)).toHaveLength(254);
      expect(ok(RegisterRequestSchema, register({ email: email(57) })).email).toBe(email(57));
      expect(email(58)).toHaveLength(255);
      expect(onlyError(RegisterRequestSchema, register({ email: email(58) }), 'email')).toBe(
        'Email tối đa 254 ký tự',
      );
    });
  });

  describe('password', () => {
    it('12 ký tự nhận, 11 từ chối; 128 nhận, 129 từ chối', () => {
      expect(ok(RegisterRequestSchema, register({ password: 'tuyet-cuoi-9' })).password).toBe('tuyet-cuoi-9');
      expect(onlyError(RegisterRequestSchema, register({ password: 'tuyet-cuoi-' }), 'password')).toBe(
        'Mật khẩu cần ít nhất 12 ký tự',
      );
      expect(ok(RegisterRequestSchema, register({ password: 'x'.repeat(126) + '1Y' })).password).toHaveLength(128);
      expect(onlyError(RegisterRequestSchema, register({ password: 'x'.repeat(129) }), 'password')).toBe(
        'Mật khẩu tối đa 128 ký tự',
      );
    });

    it.each([
      ['12 dấu cách', ' '.repeat(12)],
      ['tab và xuống dòng', '\t\n'.repeat(6)],
      ['dấu cách không ngắt', NBSP.repeat(12)],
      ['ký tự zero-width', ZWSP.repeat(12)],
    ])('từ chối mật khẩu chỉ có khoảng trắng (%s)', (_, password) => {
      expect(onlyError(RegisterRequestSchema, register({ password }), 'password')).toBe(
        'Mật khẩu không được chỉ có khoảng trắng',
      );
    });

    it('giữ nguyên mật khẩu: không cắt khoảng trắng hai đầu, nhận tiếng Việt và emoji', () => {
      expect(ok(RegisterRequestSchema, register({ password: '  song tren nui  ' })).password).toBe('  song tren nui  ');
      expect(ok(RegisterRequestSchema, register({ password: 'mậtkhẩuViệtNam' })).password).toBe('mậtkhẩuViệtNam');
      expect(ok(RegisterRequestSchema, register({ password: EMOJI + 'song-tren-nui' })).password).toBe(
        EMOJI + 'song-tren-nui',
      );
    });

    it('độ dài đếm theo ký tự Unicode: mỗi emoji tính 1 ký tự (không phải 2 đơn vị UTF-16)', () => {
      expect(onlyError(RegisterRequestSchema, register({ password: EMOJI.repeat(11) }), 'password')).toBe(
        'Mật khẩu cần ít nhất 12 ký tự',
      );
      expect(ok(RegisterRequestSchema, register({ displayName: EMOJI.repeat(50) })).displayName).toBe(
        EMOJI.repeat(50),
      );
      expect(
        onlyError(RegisterRequestSchema, register({ displayName: EMOJI.repeat(51) }), 'displayName'),
      ).toBe('Tên hiển thị tối đa 50 ký tự');
    });

    it('mật khẩu ngắn chỉ báo một lỗi (không kèm lỗi khoảng trắng)', () => {
      expect(errors(RegisterRequestSchema, register({ password: '   ' }))).toEqual([
        { field: 'password', message: 'Mật khẩu cần ít nhất 12 ký tự' },
      ]);
    });
  });

  describe('displayName', () => {
    it.each([
      ['Lan', 'Lan'],
      ['  Lan  ', 'Lan'],
      ['Nguyễn Thị Lan', 'Nguyễn Thị Lan'],
      ['X Æ A-12', 'X Æ A-12'],
      [`Lan ${EMOJI}`, `Lan ${EMOJI}`],
      [FAMILY, FAMILY], // ZWJ trong emoji không bị coi là ký tự vô hình
      ['<script>', '<script>'], // không lọc HTML ở đây: web, app tự escape khi hiển thị
      [`${DECOMPOSED_A}nh`, 'Ành'], // chuẩn hoá NFC
    ])('nhận %j → %j', (input, expected) => {
      expect(ok(RegisterRequestSchema, register({ displayName: input })).displayName).toBe(expected);
    });

    it('50 ký tự nhận, 51 từ chối (đếm sau khi cắt khoảng trắng)', () => {
      expect(ok(RegisterRequestSchema, register({ displayName: 'a'.repeat(50) })).displayName).toHaveLength(
        50,
      );
      expect(
        ok(RegisterRequestSchema, register({ displayName: `  ${'a'.repeat(50)}  ` })).displayName,
      ).toHaveLength(50);
      expect(onlyError(RegisterRequestSchema, register({ displayName: 'a'.repeat(51) }), 'displayName')).toBe(
        'Tên hiển thị tối đa 50 ký tự',
      );
    });

    it.each([
      ['chuỗi rỗng', ''],
      ['toàn dấu cách', '     '],
      ['zero-width space', ZWSP],
      ['BOM', BOM],
      ['dấu cách không ngắt', NBSP.repeat(3)],
      ['ký tự lấp chỗ tiếng Hàn', HANGUL_FILLER],
      ['trộn ký tự vô hình', `${ZWSP} ${BOM}${NBSP}`],
    ])('từ chối tên trống (%s): đúng một lỗi', (_, displayName) => {
      expect(onlyError(RegisterRequestSchema, register({ displayName }), 'displayName')).toBe(
        'Tên hiển thị không được để trống',
      );
    });

    it.each([
      ['xuống dòng', 'Lan\nAnh'],
      ['xuống dòng kiểu Windows', 'Lan\r\nAnh'],
      ['tab', 'Lan\tAnh'],
      ['ký tự NUL', `Lan${ch(0)}`],
      ['ký tự ESC', `Lan${ch(0x1b)}[31m`],
      ['ngắt dòng Unicode', `Lan${LINE_SEP}Anh`],
    ])('từ chối tên có ký tự điều khiển (%s)', (_, displayName) => {
      expect(onlyError(RegisterRequestSchema, register({ displayName }), 'displayName')).toBe(
        'Tên hiển thị chỉ được viết trên một dòng',
      );
    });
  });

  it('bỏ trường lạ: không tự cấp role, status, id khi đăng ký', () => {
    const data = ok(
      RegisterRequestSchema,
      register({ role: 'superadmin', status: 'active', id: 'x', passwordHash: 'y' }),
    );
    expect(Object.keys(data).sort()).toEqual(['code', 'displayName', 'email', 'password', 'registrationId']);
  });

  it('nhiều trường sai cùng lúc: báo đủ từng trường', () => {
    expect(
      errors(RegisterRequestSchema, register({ email: 'x', password: '1', displayName: '' })).map((e) => e.field),
    ).toEqual(['email', 'password', 'displayName']);
  });
});

describe('TF05C: đăng nhập, refresh, Google', () => {
  it('đăng nhập: email chỉ cần có (cắt khoảng trắng), không kiểm định dạng để mọi lỗi trả câu chung', () => {
    expect(ok(LoginRequestSchema, { email: '  Lan@Example.com ', password: 'x' }).email).toBe(
      'Lan@Example.com',
    );
    expect(ok(LoginRequestSchema, { email: 'khong-phai-email', password: 'x' }).email).toBe(
      'khong-phai-email',
    );
    expect(onlyError(LoginRequestSchema, { email: '   ', password: 'x' }, 'email')).toBe('Nhập email');
    expect(onlyError(LoginRequestSchema, { email: 'a'.repeat(255), password: 'x' }, 'email')).toBe(
      'Email tối đa 254 ký tự',
    );
  });

  it('đăng nhập: mật khẩu cũ toàn khoảng trắng vẫn gửi được (tài khoản tạo trước TF05C), trống thì báo', () => {
    expect(ok(LoginRequestSchema, { email: 'a@x.com', password: ' '.repeat(8) }).password).toBe(
      ' '.repeat(8),
    );
    expect(onlyError(LoginRequestSchema, { email: 'a@x.com', password: '' }, 'password')).toBe(
      'Nhập mật khẩu',
    );
    expect(onlyError(LoginRequestSchema, { email: 'a@x.com', password: 'x'.repeat(129) }, 'password')).toBe(
      'Mật khẩu tối đa 128 ký tự',
    );
  });

  it.each([
    ['không gửi', undefined, undefined],
    ['bình thường', 'Pixel 8', 'Pixel 8'],
    ['cắt khoảng trắng', '  Pixel 8  ', 'Pixel 8'],
    ['toàn khoảng trắng → coi như không gửi', '    ', undefined],
    ['chuỗi rỗng → coi như không gửi', '', undefined],
    ['zero-width → coi như không gửi', ZWSP, undefined],
    ['xuống dòng đổi thành dấu cách', 'Pixel\n8', 'Pixel 8'],
    ['ký tự điều khiển bị bỏ', `Pixel${ch(0)}${ch(0x1b)} 8`, 'Pixel 8'],
  ])('tên thiết bị %s', (_, deviceName, expected) => {
    const data = ok(LoginRequestSchema, {
      email: 'a@x.com',
      password: 'x',
      ...(deviceName === undefined ? {} : { deviceName }),
    });
    expect(data.deviceName).toBe(expected);
  });

  it('tên thiết bị: 100 ký tự nhận, 101 từ chối; sai kiểu từ chối', () => {
    expect(
      ok(LoginRequestSchema, { email: 'a@x.com', password: 'x', deviceName: 'd'.repeat(100) }).deviceName,
    ).toHaveLength(100);
    expect(
      onlyError(
        LoginRequestSchema,
        { email: 'a@x.com', password: 'x', deviceName: 'd'.repeat(101) },
        'deviceName',
      ),
    ).toBe('Tên thiết bị tối đa 100 ký tự');
    expect(
      onlyError(LoginRequestSchema, { email: 'a@x.com', password: 'x', deviceName: 8 }, 'deviceName'),
    ).toBe('Phải là chuỗi ký tự');
  });

  it('refresh: không có body, null, {} đều hợp lệ (web đọc cookie); token rỗng, quá dài, sai kiểu thì báo', () => {
    for (const body of [undefined, null, {}]) expect(ok(RefreshRequestSchema, body)).toEqual({});
    expect(ok(RefreshRequestSchema, { refreshToken: 't'.repeat(200) }).refreshToken).toHaveLength(200);
    expect(onlyError(RefreshRequestSchema, { refreshToken: '' }, 'refreshToken')).toBe('Thiếu refresh token');
    expect(onlyError(RefreshRequestSchema, { refreshToken: 't'.repeat(201) }, 'refreshToken')).toBe(
      'Refresh token không hợp lệ',
    );
    expect(onlyError(RefreshRequestSchema, { refreshToken: 5 }, 'refreshToken')).toBe('Phải là chuỗi ký tự');
  });

  it('Google: idToken 1–4096 ký tự, tên thiết bị như đăng nhập', () => {
    expect(ok(GoogleLoginRequestSchema, { idToken: 'x'.repeat(4096), deviceName: '  ' })).toEqual({
      idToken: 'x'.repeat(4096),
    });
    expect(onlyError(GoogleLoginRequestSchema, { idToken: '' }, 'idToken')).toBe('Thiếu ID token của Google');
    expect(onlyError(GoogleLoginRequestSchema, { idToken: 'x'.repeat(4097) }, 'idToken')).toBe(
      'ID token của Google không hợp lệ',
    );
    expect(onlyError(GoogleLoginRequestSchema, {}, 'idToken')).toBe('Thiếu trường này');
  });
});

describe('TF05C: sửa hồ sơ (UpdateProfileRequestSchema)', () => {
  it('cần ít nhất một trường; trường lạ (email, role, id) không tính và bị bỏ', () => {
    for (const body of [{}, { email: 'x@y.com' }, { role: 'superadmin' }, { id: 'x', status: 'locked' }]) {
      expect(errors(UpdateProfileRequestSchema, body)).toEqual([
        { field: '', message: 'Cần ít nhất một trường để cập nhật' },
      ]);
    }
    expect(
      ok(UpdateProfileRequestSchema, { displayName: 'Lan', email: 'x@y.com', role: 'superadmin' }),
    ).toEqual({ displayName: 'Lan' });
  });

  it('tên hiển thị: cùng quy tắc với đăng ký; không cho xoá (null, "")', () => {
    expect(ok(UpdateProfileRequestSchema, { displayName: '  Lan  ' }).displayName).toBe('Lan');
    expect(onlyError(UpdateProfileRequestSchema, { displayName: '' }, 'displayName')).toBe(
      'Tên hiển thị không được để trống',
    );
    expect(onlyError(UpdateProfileRequestSchema, { displayName: ZWSP }, 'displayName')).toBe(
      'Tên hiển thị không được để trống',
    );
    expect(onlyError(UpdateProfileRequestSchema, { displayName: 'Lan\nAnh' }, 'displayName')).toBe(
      'Tên hiển thị chỉ được viết trên một dòng',
    );
    expect(onlyError(UpdateProfileRequestSchema, { displayName: null }, 'displayName')).toBe(
      'Phải là chuỗi ký tự',
    );
  });

  describe('phone', () => {
    it.each([
      ['0912345678', '0912345678'],
      ['+84912345678', '+84912345678'],
      ['+84 912 345 678', '+84912345678'],
      ['(+84) 912-345.678', '+84912345678'],
      ['12345678', '12345678'], // 8 chữ số: nhỏ nhất
      ['123456789012345', '123456789012345'], // 15 chữ số: lớn nhất
      ['+123456789012345', '+123456789012345'],
    ])('nhận %j → %j', (input, expected) => {
      expect(ok(UpdateProfileRequestSchema, { phone: input }).phone).toBe(expected);
    });

    it.each([null, '', '   '])('xoá bằng %j → null', (input) => {
      expect(ok(UpdateProfileRequestSchema, { phone: input }).phone).toBeNull();
    });

    it.each([
      '1234567', // 7 chữ số
      '1234567890123456', // 16 chữ số
      '+',
      '++84912345678',
      '84+912345678',
      '0912abc678',
      '09123456７８', // số toàn chiều rộng
      '٠٩١٢٣٤٥٦٧٨', // chữ số Ả Rập
      '0912345678 ext 12',
    ])('từ chối %j', (input) => {
      expect(onlyError(UpdateProfileRequestSchema, { phone: input }, 'phone')).toBe(
        'Số điện thoại gồm 8–15 chữ số, có thể bắt đầu bằng +',
      );
    });

    it('sai kiểu (số) từ chối', () => {
      expect(onlyError(UpdateProfileRequestSchema, { phone: 912345678 }, 'phone')).toBe(
        'Phải là chuỗi ký tự',
      );
    });
  });

  describe('dateOfBirth', () => {
    const year = new Date().getUTCFullYear();
    it.each(['2000-05-20', '2008-02-29', `${year - 13}-01-01`, `${year - 120}-12-31`])('nhận %j', (input) => {
      expect(ok(UpdateProfileRequestSchema, { dateOfBirth: input }).dateOfBirth).toBe(input);
    });

    it.each([null, '', '  '])('xoá bằng %j → null', (input) => {
      expect(ok(UpdateProfileRequestSchema, { dateOfBirth: input }).dateOfBirth).toBeNull();
    });

    it.each([
      '20-05-2000',
      '2000/05/20',
      '2000-5-20',
      '2000-05-20T00:00:00Z',
      '2000-13-01',
      '2000-00-10',
      '2000-02-30',
      '2001-02-29',
      '2000-04-31',
      'hôm qua',
    ])('từ chối định dạng sai %j: đúng một lỗi', (input) => {
      expect(errors(UpdateProfileRequestSchema, { dateOfBirth: input })).toEqual([
        { field: 'dateOfBirth', message: 'Ngày sinh không hợp lệ (YYYY-MM-DD)' },
      ]);
    });

    it.each([
      `${year + 1}-01-01`,
      `${year - 5}-01-01`,
      `${year - 12}-12-31`,
      `${year - 122}-01-01`,
      '0000-01-01',
    ])('từ chối tuổi ngoài 13–120: %j', (input) => {
      expect(onlyError(UpdateProfileRequestSchema, { dateOfBirth: input }, 'dateOfBirth')).toBe(
        'Tuổi phải từ 13 đến 120',
      );
    });

    it('sai kiểu (số) từ chối', () => {
      expect(errors(UpdateProfileRequestSchema, { dateOfBirth: 20000520 }).map((e) => e.field)).toEqual([
        'dateOfBirth',
      ]);
    });
  });

  describe('gender', () => {
    it.each(['male', 'female', 'other'])('nhận %j', (g) => {
      expect(ok(UpdateProfileRequestSchema, { gender: g }).gender).toBe(g);
    });
    it.each([null, ''])('xoá bằng %j', (g) => {
      expect(ok(UpdateProfileRequestSchema, { gender: g }).gender).toBeNull();
    });
    it.each(['Male', 'nam', 'unknown', ' male', 1])('từ chối %j', (g) => {
      expect(onlyError(UpdateProfileRequestSchema, { gender: g }, 'gender')).toBe(
        'Giới tính là male, female hoặc other',
      );
    });
  });

  describe('nationality', () => {
    it.each([
      ['VN', 'VN'],
      ['vn', 'VN'],
      [' us ', 'US'],
      ['Jp', 'JP'],
    ])('nhận %j → %j', (input, expected) => {
      expect(ok(UpdateProfileRequestSchema, { nationality: input }).nationality).toBe(expected);
    });
    it.each([null, '', '  '])('xoá bằng %j', (input) => {
      expect(ok(UpdateProfileRequestSchema, { nationality: input }).nationality).toBeNull();
    });
    it.each(['XX', 'ZZ', 'EU', 'UN', 'AA', 'VNM', 'V', 'V1', 'Việt Nam', '84'])(
      'từ chối mã không có thật hoặc sai dạng %j',
      (input) => {
        expect(onlyError(UpdateProfileRequestSchema, { nationality: input }, 'nationality')).toBe(
          'Quốc tịch là mã quốc gia 2 chữ cái (ví dụ VN)',
        );
      },
    );
  });

  it('nhiều trường sai cùng lúc: báo đủ từng trường, mỗi trường một lỗi', () => {
    expect(
      errors(UpdateProfileRequestSchema, {
        phone: '1',
        dateOfBirth: '2000-02-30',
        gender: 'x',
        nationality: 'XX',
        displayName: '',
      }).map((e) => e.field),
    ).toEqual(['displayName', 'phone', 'dateOfBirth', 'gender', 'nationality']);
  });
});

describe('TF05C: mật khẩu (đổi, quên, đặt lại)', () => {
  it('đổi mật khẩu: mật khẩu mới theo quy tắc đăng ký, phải khác mật khẩu cũ', () => {
    expect(ok(ChangePasswordRequestSchema, { currentPassword: 'cu', newPassword: PASSWORD })).toEqual({
      currentPassword: 'cu',
      newPassword: PASSWORD,
    });
    expect(
      onlyError(
        ChangePasswordRequestSchema,
        { currentPassword: PASSWORD, newPassword: PASSWORD },
        'newPassword',
      ),
    ).toBe('Mật khẩu mới phải khác mật khẩu hiện tại');
    expect(
      onlyError(
        ChangePasswordRequestSchema,
        { currentPassword: 'cu', newPassword: ' '.repeat(10) },
        'newPassword',
      ),
    ).toBe('Mật khẩu không được chỉ có khoảng trắng');
    expect(
      onlyError(ChangePasswordRequestSchema, { currentPassword: 'cu', newPassword: 'ngan' }, 'newPassword'),
    ).toBe('Mật khẩu cần ít nhất 8 ký tự');
    expect(
      onlyError(
        ChangePasswordRequestSchema,
        { currentPassword: '', newPassword: PASSWORD },
        'currentPassword',
      ),
    ).toBe('Nhập mật khẩu');
    expect(errors(ChangePasswordRequestSchema, {}).map((e) => e.field)).toEqual([
      'currentPassword',
      'newPassword',
    ]);
  });

  it('quên mật khẩu: email chỉ cần có (cắt khoảng trắng); sai định dạng vẫn nhận để không lộ email nào đã đăng ký', () => {
    expect(ok(ForgotPasswordRequestSchema, { email: '  Lan@Example.com  ' }).email).toBe('Lan@Example.com');
    expect(ok(ForgotPasswordRequestSchema, { email: 'khong-phai-email' }).email).toBe('khong-phai-email');
    expect(onlyError(ForgotPasswordRequestSchema, { email: '  ' }, 'email')).toBe('Nhập email');
    expect(onlyError(ForgotPasswordRequestSchema, {}, 'email')).toBe('Thiếu trường này');
  });

  it('đặt lại: token 1–200 ký tự, mật khẩu mới theo quy tắc đăng ký', () => {
    expect(
      ok(ResetPasswordRequestSchema, { token: 't'.repeat(200), newPassword: PASSWORD }).token,
    ).toHaveLength(200);
    expect(onlyError(ResetPasswordRequestSchema, { token: '', newPassword: PASSWORD }, 'token')).toBe(
      'Thiếu mã đặt lại mật khẩu',
    );
    expect(
      onlyError(ResetPasswordRequestSchema, { token: 't'.repeat(201), newPassword: PASSWORD }, 'token'),
    ).toBe('Mã đặt lại mật khẩu không hợp lệ');
    expect(
      onlyError(ResetPasswordRequestSchema, { token: 't', newPassword: ZWSP.repeat(9) }, 'newPassword'),
    ).toBe('Mật khẩu không được chỉ có khoảng trắng');
    expect(
      onlyError(ResetPasswordRequestSchema, { token: 't', newPassword: 'x'.repeat(129) }, 'newPassword'),
    ).toBe('Mật khẩu tối đa 128 ký tự');
  });
});

describe('TF05C: quản trị (tìm người dùng, cấp quyền) và service token', () => {
  it('tìm người dùng: page mặc định 1, nhận chuỗi số từ query; từ khoá cắt khoảng trắng, tối đa 100', () => {
    expect(ok(SearchUsersQuerySchema, {})).toEqual({ page: 1 });
    expect(ok(SearchUsersQuerySchema, { page: '1000', query: '  lan  ' })).toEqual({
      page: 1000,
      query: 'lan',
    });
    expect(ok(SearchUsersQuerySchema, { query: 'q'.repeat(100) }).query).toHaveLength(100);
    expect(onlyError(SearchUsersQuerySchema, { query: 'q'.repeat(101) }, 'query')).toBe(
      'Từ khoá tối đa 100 ký tự',
    );
  });

  it.each([
    ['0', 'Số trang từ 1 trở lên'],
    ['-1', 'Số trang từ 1 trở lên'],
    ['1001', 'Số trang tối đa 1000'],
    ['1.5', 'Số trang phải là số nguyên'],
    ['abc', 'Số trang phải là số'],
  ])('page %j: %s', (page, message) => {
    expect(onlyError(SearchUsersQuerySchema, { page }, 'page')).toBe(message);
  });

  it('cấp quyền: userId phải là UUID', () => {
    expect(ok(GrantStaffRequestSchema, { userId: '018d9f20-0000-7000-8000-00000000000a' }).userId).toBe(
      '018d9f20-0000-7000-8000-00000000000a',
    );
    for (const userId of ['x', '', '018d9f20-0000-7000-8000', 123]) {
      expect(errors(GrantStaffRequestSchema, { userId }).map((e) => e.field)).toEqual(['userId']);
    }
    expect(onlyError(GrantStaffRequestSchema, { userId: 'x' }, 'userId')).toBe('userId không hợp lệ');
  });

  it('service token: đủ 3 trường, có giới hạn độ dài', () => {
    const body = { clientId: 'video-worker', clientSecret: 's'.repeat(200), audience: 'core-api' };
    expect(ok(ServiceTokenRequestSchema, body)).toEqual(body);
    expect(errors(ServiceTokenRequestSchema, {}).map((e) => e.field)).toEqual([
      'clientId',
      'clientSecret',
      'audience',
    ]);
    expect(
      errors(ServiceTokenRequestSchema, {
        ...body,
        clientId: 'c'.repeat(51),
        clientSecret: 's'.repeat(201),
        audience: '',
      }).map((e) => e.field),
    ).toEqual(['clientId', 'clientSecret', 'audience']);
  });
});
