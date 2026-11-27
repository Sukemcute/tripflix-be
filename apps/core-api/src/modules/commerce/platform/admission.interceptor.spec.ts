import 'reflect-metadata';
import { HttpException, HttpStatus, ServiceUnavailableException, type ExecutionContext, type Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, Subject, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdmissionConfig } from './admission-config.js';
import { AdmissionGate } from './admission-gate.js';
import { AdmissionLane } from './admission-lane.decorator.js';
import { AdmissionInterceptor } from './admission.interceptor.js';

@AdmissionLane('browse')
class BrowseController {
  handle(this: void): string { return 'ok'; }
}

@AdmissionLane('transaction')
class TransactionController {
  handle(this: void): string { return 'ok'; }
}

@AdmissionLane('exempt')
class ExemptController {
  handle(this: void): string { return 'ok'; }
}

class UnclassifiedController {
  handle(this: void): string { return 'ok'; }
}

@AdmissionLane('browse')
class OverrideController {
  @AdmissionLane('transaction')
  handle(this: void): string { return 'ok'; }

  @AdmissionLane('exempt')
  exempt(this: void): string { return 'ok'; }
}

const ADMISSION_CONFIG: AdmissionConfig = {
  isEnabled: true,
  total: 2,
  txReserved: 1,
  txQueueMax: 1,
  txWaitMs: 100,
};

const BUSY_RESPONSE = {
  statusCode: 503,
  code: 'BUSY_TRY_AGAIN',
  message: 'Đang đông khách, bạn thử lại sau ít giây.',
};

function createFixture(overrides: Partial<AdmissionConfig> = {}) {
  const config = { ...ADMISSION_CONFIG, ...overrides };
  const gate = new AdmissionGate(config);
  const interceptor = new AdmissionInterceptor(gate, new Reflector(), config);
  return { gate, interceptor };
}

function createContext(controller: Type<unknown>, handler: () => unknown) {
  const setHeader = vi.fn();
  const context = {
    getClass: () => controller,
    getHandler: () => handler,
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => ({ setHeader }) }),
  } as unknown as ExecutionContext;
  return { context, setHeader };
}

async function expectBusy(stream: Observable<unknown>): Promise<void> {
  const rejection: unknown = await lastValueFrom(stream).catch((error: unknown) => error);
  expect(rejection).toBeInstanceOf(ServiceUnavailableException);
  expect((rejection as ServiceUnavailableException).getStatus()).toBe(503);
  expect((rejection as ServiceUnavailableException).getResponse()).toEqual(BUSY_RESPONSE);
}

describe('AdmissionInterceptor', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('browse hết suất trả 503, Retry-After và mã lỗi; không chạy handler', async () => {
    const { gate, interceptor } = createFixture();
    expect(gate.tryBrowse()).toBe(true);
    const { context, setHeader } = createContext(BrowseController, BrowseController.prototype.handle);
    const next = { handle: vi.fn(() => of('ok')) };

    await expectBusy(interceptor.intercept(context, next));

    expect(setHeader).toHaveBeenCalledWith('Retry-After', '2');
    expect(next.handle).not.toHaveBeenCalled();
    expect(gate.snapshot()).toMatchObject({ browseInFlight: 1, txInFlight: 0, browseRejected: 1 });
  });

  it('transaction đầy hàng chờ trả cùng lỗi 503 và giữ nguyên suất đang chạy', async () => {
    const { gate, interceptor } = createFixture();
    expect(gate.tryBrowse()).toBe(true);
    expect(await gate.acquireTx()).toBe(true);
    const waiting = gate.acquireTx();
    const { context, setHeader } = createContext(TransactionController, TransactionController.prototype.handle);
    const next = { handle: vi.fn(() => of('ok')) };

    await expectBusy(interceptor.intercept(context, next));

    expect(setHeader).toHaveBeenCalledWith('Retry-After', '2');
    expect(next.handle).not.toHaveBeenCalled();
    expect(gate.snapshot()).toMatchObject({ browseInFlight: 1, txInFlight: 1, txWaiting: 1, txRejected: 1 });
    gate.release('transaction');
    expect(await waiting).toBe(true);
    gate.release('transaction');
    gate.release('browse');
  });

  it('transaction hết thời gian chờ trả 503 mà không chạy handler', async () => {
    vi.useFakeTimers();
    const { gate, interceptor } = createFixture();
    expect(gate.tryBrowse()).toBe(true);
    expect(await gate.acquireTx()).toBe(true);
    const { context, setHeader } = createContext(TransactionController, TransactionController.prototype.handle);
    const next = { handle: vi.fn(() => of('ok')) };
    const rejection = expectBusy(interceptor.intercept(context, next));

    await vi.advanceTimersByTimeAsync(100);
    await rejection;

    expect(setHeader).toHaveBeenCalledWith('Retry-After', '2');
    expect(next.handle).not.toHaveBeenCalled();
    expect(gate.snapshot()).toMatchObject({ browseInFlight: 1, txInFlight: 1, txWaiting: 0, txRejected: 1 });
  });

  it.each([
    [BrowseController, 'browseInFlight'],
    [TransactionController, 'txInFlight'],
  ] as const)('trả suất sau khi handler %s hoàn tất', async (controller, counter) => {
    const { gate, interceptor } = createFixture();
    const { context } = createContext(controller, controller.prototype.handle);
    const release = vi.spyOn(gate, 'release');
    const next = {
      handle: vi.fn(() => {
        expect(gate.snapshot()[counter]).toBe(1);
        return of('thành công');
      }),
    };

    await expect(lastValueFrom(interceptor.intercept(context, next))).resolves.toBe('thành công');

    expect(release).toHaveBeenCalledTimes(1);
    expect(gate.snapshot()).toMatchObject({ browseInFlight: 0, txInFlight: 0 });
  });

  it.each([
    new Error('Lỗi xử lý'),
    new HttpException({ outcome: 'pending' }, HttpStatus.ACCEPTED),
  ])('trả suất khi observable phát lỗi, kể cả checkout trả 202: %s', async (error) => {
    const { gate, interceptor } = createFixture();
    const { context } = createContext(TransactionController, TransactionController.prototype.handle);
    const release = vi.spyOn(gate, 'release');
    const next = { handle: vi.fn(() => throwError(() => error)) };

    await expect(lastValueFrom(interceptor.intercept(context, next))).rejects.toBe(error);

    expect(release).toHaveBeenCalledExactlyOnceWith('transaction');
    expect(gate.snapshot()).toMatchObject({ browseInFlight: 0, txInFlight: 0 });
  });

  it('trả suất cả khi next.handle ném lỗi đồng bộ', async () => {
    const { gate, interceptor } = createFixture();
    const { context } = createContext(BrowseController, BrowseController.prototype.handle);
    const error = new Error('Lỗi đồng bộ');
    const release = vi.spyOn(gate, 'release');
    const next = { handle: vi.fn(() => { throw error; }) };

    await expect(lastValueFrom(interceptor.intercept(context, next))).rejects.toBe(error);

    expect(release).toHaveBeenCalledExactlyOnceWith('browse');
    expect(gate.snapshot().browseInFlight).toBe(0);
  });

  it('giữ suất khi response còn mở và chỉ trả một lần sau complete rồi unsubscribe', () => {
    const { gate, interceptor } = createFixture();
    const { context } = createContext(BrowseController, BrowseController.prototype.handle);
    const response = new Subject<string>();
    const release = vi.spyOn(gate, 'release');
    const subscription = interceptor.intercept(context, { handle: () => response }).subscribe();

    response.next('đang xử lý');
    expect(gate.snapshot().browseInFlight).toBe(1);
    expect(release).not.toHaveBeenCalled();
    response.complete();
    subscription.unsubscribe();
    subscription.unsubscribe();

    expect(release).toHaveBeenCalledExactlyOnceWith('browse');
    expect(gate.snapshot().browseInFlight).toBe(0);
  });

  it('trả suất đúng một lần khi response bị unsubscribe trước complete', () => {
    const { gate, interceptor } = createFixture();
    const { context } = createContext(BrowseController, BrowseController.prototype.handle);
    const response = new Subject<string>();
    const release = vi.spyOn(gate, 'release');
    const subscription = interceptor.intercept(context, { handle: () => response }).subscribe();

    expect(gate.snapshot().browseInFlight).toBe(1);
    subscription.unsubscribe();
    subscription.unsubscribe();
    response.complete();

    expect(release).toHaveBeenCalledExactlyOnceWith('browse');
    expect(gate.snapshot().browseInFlight).toBe(0);
  });

  it('trả lại suất được cấp muộn nếu transaction đã unsubscribe khi còn chờ', async () => {
    const { gate, interceptor } = createFixture();
    expect(gate.tryBrowse()).toBe(true);
    expect(await gate.acquireTx()).toBe(true);
    const { context } = createContext(TransactionController, TransactionController.prototype.handle);
    const next = { handle: vi.fn(() => of('ok')) };
    const release = vi.spyOn(gate, 'release');
    const acquireTx = vi.spyOn(gate, 'acquireTx');
    const subscription = interceptor.intercept(context, next).subscribe();
    const pendingAdmission = acquireTx.mock.results[0]?.value;

    expect(gate.snapshot().txWaiting).toBe(1);
    expect(pendingAdmission).toBeInstanceOf(Promise);
    subscription.unsubscribe();
    subscription.unsubscribe();
    expect(release).not.toHaveBeenCalled();
    gate.release('transaction');
    await pendingAdmission;

    expect(next.handle).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenNthCalledWith(1, 'transaction');
    expect(release).toHaveBeenNthCalledWith(2, 'transaction');
    expect(gate.snapshot()).toMatchObject({ browseInFlight: 1, txInFlight: 0, txWaiting: 0 });
  });

  it('chỉ cấp suất khi subscribe và cấp lại cho mỗi lần subscribe', async () => {
    const { gate, interceptor } = createFixture();
    const { context } = createContext(BrowseController, BrowseController.prototype.handle);
    const tryBrowse = vi.spyOn(gate, 'tryBrowse');
    const release = vi.spyOn(gate, 'release');
    const next = { handle: vi.fn(() => of('ok')) };
    const stream = interceptor.intercept(context, next);

    expect(tryBrowse).not.toHaveBeenCalled();
    expect(next.handle).not.toHaveBeenCalled();
    await expect(lastValueFrom(stream)).resolves.toBe('ok');
    await expect(lastValueFrom(stream)).resolves.toBe('ok');

    expect(tryBrowse).toHaveBeenCalledTimes(2);
    expect(next.handle).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
    expect(gate.snapshot().browseInFlight).toBe(0);
  });

  it.each([ExemptController, UnclassifiedController])('exempt hoặc controller chưa gán lane không bị đếm khi quá tải: %s', async (controller) => {
    const { gate, interceptor } = createFixture();
    expect(gate.tryBrowse()).toBe(true);
    expect(await gate.acquireTx()).toBe(true);
    const snapshot = gate.snapshot();
    const { context, setHeader } = createContext(controller, controller.prototype.handle);
    const release = vi.spyOn(gate, 'release');

    await expect(lastValueFrom(interceptor.intercept(context, { handle: () => of('ok') }))).resolves.toBe('ok');

    expect(setHeader).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(gate.snapshot()).toEqual(snapshot);
  });

  it.each([BrowseController, TransactionController])('tắt cấu hình thì đi thẳng dù quá tải: %s', async (controller) => {
    const { gate, interceptor } = createFixture({ isEnabled: false });
    expect(gate.tryBrowse()).toBe(true);
    expect(await gate.acquireTx()).toBe(true);
    const snapshot = gate.snapshot();
    const { context, setHeader } = createContext(controller, controller.prototype.handle);
    const tryBrowse = vi.spyOn(gate, 'tryBrowse');
    const acquireTx = vi.spyOn(gate, 'acquireTx');
    const release = vi.spyOn(gate, 'release');

    await expect(lastValueFrom(interceptor.intercept(context, { handle: () => of('ok') }))).resolves.toBe('ok');

    expect(tryBrowse).not.toHaveBeenCalled();
    expect(acquireTx).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(setHeader).not.toHaveBeenCalled();
    expect(gate.snapshot()).toEqual(snapshot);
  });

  it('Reflector ưu tiên lane transaction của handler hơn browse của class', async () => {
    const { gate, interceptor } = createFixture();
    expect(gate.tryBrowse()).toBe(true);
    const { context } = createContext(OverrideController, OverrideController.prototype.handle);
    const next = {
      handle: () => {
        expect(gate.snapshot()).toMatchObject({ browseInFlight: 1, txInFlight: 1 });
        return of('ok');
      },
    };

    await expect(lastValueFrom(interceptor.intercept(context, next))).resolves.toBe('ok');

    expect(gate.snapshot()).toMatchObject({ browseInFlight: 1, txInFlight: 0, browseRejected: 0 });
  });

  it('Reflector ưu tiên exempt của handler hơn browse của class khi hết suất', async () => {
    const { gate, interceptor } = createFixture();
    expect(gate.tryBrowse()).toBe(true);
    expect(await gate.acquireTx()).toBe(true);
    const snapshot = gate.snapshot();
    const { context } = createContext(OverrideController, OverrideController.prototype.exempt);

    await expect(lastValueFrom(interceptor.intercept(context, { handle: () => of('ok') }))).resolves.toBe('ok');

    expect(gate.snapshot()).toEqual(snapshot);
  });
});
