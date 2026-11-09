import { z } from 'zod';
import { NEW_PASSWORD_MAX, PASSWORD_MAX, PASSWORD_MIN } from '../domain/credentials.js';
import { isCommonRegistrationPassword, REGISTRATION_PASSWORD_MIN } from '../domain/registration.js';
import { isKnownCountry } from '../../account/domain/countries.js';
import { GENDERS, isAllowedAge, MAX_AGE, MIN_AGE } from '../../account/domain/personal-info.js';
import {
  DEVICE_NAME_MAX,
  DISPLAY_NAME_MAX,
  hasControlChars,
  hasVisibleChar,
  stripControlChars,
} from '../domain/text-rules.js';

/**
 * Kiểm đầu vào của module access (TF05C): câu lỗi tiếng Việt và các trường dùng chung.
 * Câu lỗi viết riêng trong schema được ưu tiên; bảng dưới chỉ thay câu mặc định tiếng Anh của zod.
 * Chỉ áp dụng khi parse qua ZodBody của access, không đổi cấu hình zod chung của module khác.
 */
export const accessErrorMap: z.core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case 'invalid_type':
      if (issue.expected === 'object') return 'Dữ liệu gửi lên phải là một đối tượng JSON';
      if (issue.input === undefined) return 'Thiếu trường này';
      if (issue.expected === 'int') return 'Phải là số nguyên';
      if (issue.expected === 'number') return 'Phải là số';
      if (issue.expected === 'string') return 'Phải là chuỗi ký tự';
      return 'Sai kiểu dữ liệu';
    case 'too_small':
      if (issue.origin === 'string') {
        return Number(issue.minimum) <= 1 ? 'Không được để trống' : `Cần ít nhất ${issue.minimum} ký tự`;
      }
      if (issue.origin === 'number') return `Phải từ ${issue.minimum} trở lên`;
      return 'Giá trị quá nhỏ';
    case 'too_big':
      if (issue.origin === 'string') return `Tối đa ${issue.maximum} ký tự`;
      if (issue.origin === 'number') return `Không được lớn hơn ${issue.maximum}`;
      return 'Giá trị quá lớn';
    case 'invalid_value':
      return 'Giá trị không được hỗ trợ';
    case 'invalid_format':
      return 'Sai định dạng';
    default:
      return 'Giá trị không hợp lệ';
  }
};

/** Lỗi trả về client: tên trường (nối bằng dấu chấm) và câu lỗi. */
export interface FieldError {
  field: string;
  message: string;
}

export type ParseResult<T> = { success: true; data: T } | { success: false; errors: FieldError[] };

export function parseAccessInput<T extends z.ZodType>(schema: T, value: unknown): ParseResult<z.infer<T>> {
  const parsed = schema.safeParse(value, { error: accessErrorMap });
  if (parsed.success) return { success: true, data: parsed.data };
  return {
    success: false,
    errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
  };
}

/** Chỉ chạy kiểm tra sau khi các kiểm tra trước của trường đã qua, để mỗi trường sai chỉ báo một lỗi. */
export const whenValid = { when: (payload: { issues: readonly unknown[] }) => payload.issues.length === 0 };

/** Email để tạo tài khoản: cắt khoảng trắng hai đầu rồi mới kiểm định dạng. */
export const signupEmailField = () =>
  z.string().trim().pipe(z.email('Email không hợp lệ').max(254, 'Email tối đa 254 ký tự'));

/** Email để đăng nhập, quên mật khẩu: không kiểm định dạng, sai thì nhận câu trả lời chung, không lộ email nào đã có. */
export const lookupEmailField = () =>
  z.string().trim().min(1, 'Nhập email').max(254, 'Email tối đa 254 ký tự');

/** Mật khẩu mới (đăng ký, đổi, đặt lại): 8–64 ký tự, không được chỉ có khoảng trắng. Không cắt khoảng trắng. */
export const newPasswordField = (min = PASSWORD_MIN) =>
  z
    .string()
    .min(min, `Mật khẩu cần ít nhất ${min} ký tự`)
    .max(NEW_PASSWORD_MAX, `Mật khẩu tối đa ${NEW_PASSWORD_MAX} ký tự`)
    .refine(hasVisibleChar, { message: 'Mật khẩu không được chỉ có khoảng trắng', ...whenValid });

/** Mật khẩu đang dùng: chỉ cần có, để tài khoản tạo trước quy tắc mới vẫn đăng nhập được. */
export const currentPasswordField = () =>
  z.string().min(1, 'Nhập mật khẩu').max(PASSWORD_MAX, `Mật khẩu tối đa ${PASSWORD_MAX} ký tự`);

export const registrationPasswordField = () =>
  newPasswordField(REGISTRATION_PASSWORD_MIN)
    .refine((value) => Array.from(value).length >= REGISTRATION_PASSWORD_MIN, {
      message: `Mật khẩu cần ít nhất ${REGISTRATION_PASSWORD_MIN} ký tự`,
      ...whenValid,
    })
    .refine((value) => !isCommonRegistrationPassword(value), {
      message: 'Mật khẩu quá phổ biến hoặc dễ đoán. Hãy chọn mật khẩu khác.',
      ...whenValid,
    });

/** Tên hiển thị: chuẩn hoá Unicode NFC, cắt khoảng trắng, 1–30 ký tự, một dòng, có ít nhất một ký tự nhìn thấy. */
export const displayNameField = () =>
  z
    .string()
    .normalize('NFC')
    .trim()
    .min(1, { message: 'Tên hiển thị không được để trống', abort: true })
    .max(DISPLAY_NAME_MAX, `Tên hiển thị tối đa ${DISPLAY_NAME_MAX} ký tự`)
    .refine((v) => !hasControlChars(v), { message: 'Tên hiển thị chỉ được viết trên một dòng', ...whenValid })
    .refine(hasVisibleChar, { message: 'Tên hiển thị không được để trống', ...whenValid });

/** Ngày sinh YYYY-MM-DD, tuổi tính theo ngày hiện tại khi gọi API (dùng khi đăng ký và khi sửa hồ sơ). */
export const dateOfBirthField = () =>
  z.iso
    .date('Ngày sinh không hợp lệ (YYYY-MM-DD)')
    .refine((d) => isAllowedAge(d, new Date()), { message: `Tuổi phải từ ${MIN_AGE} đến ${MAX_AGE}`, ...whenValid });

export const genderField = () => z.enum(GENDERS, 'Giới tính là male, female hoặc other');

/** Mã quốc gia ISO 3166-1 alpha-2; nhận chữ thường, khoảng trắng hai đầu. */
export const nationalityField = () =>
  z
    .string('Quốc tịch là mã quốc gia 2 chữ cái (ví dụ VN)')
    .trim()
    .toUpperCase()
    .refine(isKnownCountry, 'Quốc tịch là mã quốc gia 2 chữ cái (ví dụ VN)');

/** Tên thiết bị do app gửi: bỏ ký tự điều khiển, tối đa 100 ký tự; trống thì coi như không gửi. */
export const deviceNameField = () =>
  z
    .string()
    .overwrite(stripControlChars)
    .max(DEVICE_NAME_MAX, `Tên thiết bị tối đa ${DEVICE_NAME_MAX} ký tự`)
    .transform((v) => (hasVisibleChar(v) ? v : undefined))
    .optional();
