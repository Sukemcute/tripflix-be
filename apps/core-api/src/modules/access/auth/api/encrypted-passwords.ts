import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
  SetMetadata,
  UseInterceptors,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { defer, switchMap, type Observable } from 'rxjs';
import { PasswordEncryption } from '../application/password-encryption.js';
import { PasswordEnvelopeError, passwordSubject, type PasswordPurpose } from '../domain/password-envelope.js';
import type { FieldError } from './validation.js';

export const PASSWORD_ENVELOPE_INVALID_CODE = 'password_envelope_invalid';
export const PASSWORD_ENCRYPTION_REQUIRED_CODE = 'password_encryption_required';
export const PASSWORD_ENVELOPE_INVALID_MESSAGE =
  'Không đọc được mật khẩu đã mã hoá. Tải lại trang rồi thử lại.';
export const PASSWORD_ENCRYPTION_REQUIRED_MESSAGE = 'Hãy cập nhật ứng dụng để gửi mật khẩu an toàn hơn.';

export interface EncryptedPasswordField {
  /** Trường chuỗi mã hoá client gửi, ví dụ encPassword. */
  encrypted: string;
  /** Trường mật khẩu gốc mà schema zod kiểm, ví dụ password. */
  plain: string;
  purpose: PasswordPurpose;
}

export interface EncryptedPasswordsOptions {
  fields: EncryptedPasswordField[];
  /** Trường email trong body để gắn vào AAD; không có (đổi, đặt lại mật khẩu) thì dùng chuỗi rỗng. */
  subjectField?: string;
}

const ENCRYPTED_PASSWORDS = 'tripflix:encrypted-passwords';

/**
 * Giải mã encPassword... thành password... TRƯỚC khi ZodBody kiểm (interceptor chạy trước pipe), nên luật mật khẩu,
 * use case và test cũ giữ nguyên. Body vẫn có thể gửi mật khẩu thường khi AUTH_PASSWORD_ENCRYPTION_REQUIRED=false.
 */
export const EncryptedPasswords = (options: EncryptedPasswordsOptions) =>
  applyDecorators(SetMetadata(ENCRYPTED_PASSWORDS, options), UseInterceptors(PasswordDecryptionInterceptor));

@Injectable()
export class PasswordDecryptionInterceptor implements NestInterceptor {
  private readonly logger = new Logger('PasswordDecryption');

  constructor(
    @Inject(PasswordEncryption) private readonly passwords: PasswordEncryption,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<EncryptedPasswordsOptions | undefined>(
      ENCRYPTED_PASSWORDS,
      context.getHandler(),
    );
    if (!options) return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    return defer(() => this.decryptBody(req.body, options)).pipe(switchMap(() => next.handle()));
  }

  private async decryptBody(body: unknown, options: EncryptedPasswordsOptions): Promise<void> {
    // Body không phải object: để ZodBody báo lỗi như bình thường.
    if (!body || typeof body !== 'object' || Array.isArray(body)) return;
    const data = body as Record<string, unknown>;
    const subject = options.subjectField ? passwordSubject(data[options.subjectField]) : '';
    const errors: FieldError[] = [];
    let code: string | undefined;

    for (const field of options.fields) {
      const encrypted = data[field.encrypted];
      const plain = data[field.plain];
      if (encrypted === undefined) {
        if (plain !== undefined && this.passwords.isRequired) {
          errors.push({ field: field.plain, message: PASSWORD_ENCRYPTION_REQUIRED_MESSAGE });
          code ??= PASSWORD_ENCRYPTION_REQUIRED_CODE;
        }
        continue;
      }
      if (plain !== undefined) {
        errors.push({
          field: field.encrypted,
          message: `Chỉ gửi ${field.encrypted} hoặc ${field.plain}, không gửi cả hai`,
        });
        continue;
      }
      if (typeof encrypted !== 'string') {
        errors.push({ field: field.encrypted, message: 'Phải là chuỗi ký tự' });
        continue;
      }
      try {
        data[field.plain] = await this.passwords.open(encrypted, field.purpose, subject);
        delete data[field.encrypted];
      } catch (err) {
        if (!(err instanceof PasswordEnvelopeError)) throw err;
        // Lý do chỉ ghi log (không có mật khẩu hay chuỗi mã hoá); client nhận một câu chung và tự lấy lại khoá.
        this.logger.warn({ reason: err.reason, purpose: field.purpose }, 'Từ chối mật khẩu đã mã hoá');
        errors.push({ field: field.encrypted, message: PASSWORD_ENVELOPE_INVALID_MESSAGE });
        code ??= PASSWORD_ENVELOPE_INVALID_CODE;
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Dữ liệu gửi lên không hợp lệ',
        ...(code ? { code } : {}),
        errors,
      });
    }
  }
}
