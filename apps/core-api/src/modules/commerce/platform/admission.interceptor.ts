import { type CallHandler, type ExecutionContext, Inject, Injectable, type NestInterceptor, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { defer, finalize, from, mergeMap, type Observable, of } from 'rxjs';
import { COMMERCE_ADMISSION_CONFIG, type AdmissionConfig } from './admission-config.js';
import { AdmissionGate } from './admission-gate.js';
import { ADMISSION_LANE, type CommerceAdmissionLane } from './admission-lane.js';

@Injectable()
export class AdmissionInterceptor implements NestInterceptor {
  constructor(
    @Inject(AdmissionGate) private readonly gate: AdmissionGate,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(COMMERCE_ADMISSION_CONFIG) private readonly config: AdmissionConfig,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const lane = this.reflector.getAllAndOverride<CommerceAdmissionLane>(ADMISSION_LANE, [context.getHandler(), context.getClass()]);
    if (!this.config.isEnabled || !lane || lane === 'exempt' || context.getType() !== 'http') return next.handle();

    return defer(() => {
      let hasSlot = false;
      let isFinished = false;
      const admission = lane === 'browse' ? of(this.gate.tryBrowse()) : from(this.gate.acquireTx().then((isAdmitted) => {
        // Lượt đã ngừng nghe khi còn xếp hàng vẫn phải trả suất được cấp muộn.
        if (isFinished) {
          if (isAdmitted) this.gate.release(lane);
          return false;
        }
        hasSlot = isAdmitted;
        return isAdmitted;
      }));

      return admission.pipe(
        mergeMap((isAdmitted) => {
          if (!isAdmitted) {
            context.switchToHttp().getResponse<Response>().setHeader('Retry-After', '2');
            throw new ServiceUnavailableException({
              statusCode: 503,
              code: 'BUSY_TRY_AGAIN',
              message: 'Đang đông khách, bạn thử lại sau ít giây.',
            });
          }
          hasSlot = true;
          return defer(() => next.handle());
        }),
        finalize(() => {
          isFinished = true;
          // Hoàn tất, lỗi và ngừng nghe có thể cùng xảy ra; mỗi lượt chỉ trả một suất.
          if (!hasSlot) return;
          hasSlot = false;
          this.gate.release(lane);
        }),
      );
    });
  }
}
