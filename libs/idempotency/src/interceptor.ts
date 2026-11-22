import { createHash } from 'node:crypto';
import {
  BadRequestException,
  type CallHandler,
  ConflictException,
  type DynamicModule,
  type ExecutionContext,
  Inject,
  Injectable,
  type InjectionToken,
  Module,
  type NestInterceptor,
  UnprocessableEntityException,
  UseInterceptors,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { type Observable, catchError, from, mergeMap, of, switchMap } from 'rxjs';
import type { IdempotencyStore } from './store.js';

export const IDEMPOTENCY_STORE = Symbol('IDEMPOTENCY_STORE');
export const IDEMPOTENCY_HEADER = 'idempotency-key';
/** Giữ kết quả 24 giờ: đủ cho app gửi lại khi mất mạng, không phình bảng. */
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

export const MISSING_KEY_MESSAGE = 'Thiếu header Idempotency-Key';
export const IN_PROGRESS_MESSAGE = 'Yêu cầu với Idempotency-Key này đang được xử lý, vui lòng thử lại sau';
export const KEY_REUSED_MESSAGE = 'Idempotency-Key đã được dùng cho một yêu cầu khác';

interface IdempotentRequest {
  method: string;
  originalUrl: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  /** Có khi route đã qua AccessTokenGuard của @tripflix/auth. */
  user?: { userId: string };
}

/** JSON có thứ tự khoá cố định, để gửi lại cùng nội dung nhưng khác thứ tự khoá vẫn được coi là một. */
function stringifyCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stringifyCanonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stringifyCanonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function hashRequestBody(body: unknown): string {
  return createHash('sha256').update(stringifyCanonical(body)).digest('hex');
}

/**
 * Lệnh ghi có thể bị gửi lại phải nhận Idempotency-Key (RULES §10). Lần đầu: xử lý rồi lưu kết quả.
 * Gửi lại sau khi xong: trả đúng kết quả cũ (header Idempotency-Replayed: true). Đang xử lý: 409.
 * Cùng key nhưng nội dung khác: 422. Xử lý lỗi: xoá chỗ đã giữ để client gửi lại được.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(IDEMPOTENCY_STORE) private readonly store: IdempotencyStore,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<IdempotentRequest>();
    const res = http.getResponse<{ setHeader(name: string, value: string): void }>();
    const header = req.headers[IDEMPOTENCY_HEADER];
    const key = (Array.isArray(header) ? header[0] : header)?.trim();
    if (!key || key.length > 200) throw new BadRequestException(MISSING_KEY_MESSAGE);

    const scope = `${req.user?.userId ?? 'anonymous'} ${req.method} ${req.originalUrl.split('?')[0]}`;
    const requestHash = hashRequestBody(req.body);
    const successStatus =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      (req.method === 'POST' ? 201 : 200);

    return from(this.store.begin(scope, key, requestHash, IDEMPOTENCY_TTL_SECONDS)).pipe(
      switchMap((begin) => {
        if (begin.kind !== 'started' && begin.requestHash !== requestHash) {
          throw new UnprocessableEntityException(KEY_REUSED_MESSAGE);
        }
        if (begin.kind === 'in_progress') throw new ConflictException(IN_PROGRESS_MESSAGE);
        if (begin.kind === 'replay') {
          res.setHeader('Idempotency-Replayed', 'true');
          return of(begin.responseBody);
        }
        return next.handle().pipe(
          mergeMap(async (body: unknown) => {
            await this.store.complete(scope, key, successStatus, body);
            return body;
          }),
          catchError(async (err: unknown) => {
            await this.store.abort(scope, key);
            throw err;
          }),
        );
      }),
    );
  }
}

/** Gắn lên handler (hoặc controller) có lệnh ghi cần chống gửi lại. Module phải import IdempotencyModule.forFeature. */
export const Idempotent = () => UseInterceptors(IdempotencyInterceptor);

export interface IdempotencyModuleOptions {
  inject?: InjectionToken[];
  /** Tạo store trên kết nối của module, ví dụ `new DrizzleIdempotencyStore(db, commerceIdempotencyKeys)`. */
  useFactory: (...args: never[]) => IdempotencyStore;
}

@Module({})
export class IdempotencyModule {
  /** Mỗi module gọi một lần với bảng idempotency_keys trong schema của mình. */
  static forFeature({ inject, useFactory }: IdempotencyModuleOptions): DynamicModule {
    return {
      module: IdempotencyModule,
      providers: [{ provide: IDEMPOTENCY_STORE, inject: inject ?? [], useFactory }, IdempotencyInterceptor],
      exports: [IDEMPOTENCY_STORE, IdempotencyInterceptor],
    };
  }
}
