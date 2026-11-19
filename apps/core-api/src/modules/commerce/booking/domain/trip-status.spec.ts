import { describe, expect, it } from 'vitest';
import { computeTripStartAt, computeTripStatus, findEndDate, isDueForDepartureReminder } from './trip-status.js';

describe('computeTripStatus', () => {
  it('đơn đã trả, hôm nay qua ngày kết thúc thì đã đi', () => {
    expect(computeTripStatus({ status: 'paid', endDate: '2026-11-20' }, '2026-11-21')).toBe('completed');
  });

  it('đúng ngày trả phòng / ngày bay về vẫn là sắp đi / đang đi', () => {
    expect(computeTripStatus({ status: 'paid', endDate: '2026-11-20' }, '2026-11-20')).toBe('upcoming');
    expect(computeTripStatus({ status: 'paid', endDate: '2026-11-20' }, '2026-11-01')).toBe('upcoming');
  });

  it('đơn huỷ, hoàn tiền, chưa trả hay hết hạn thì không có trạng thái chuyến dù đã qua ngày', () => {
    for (const status of ['cancelled', 'pending', 'paying', 'expired'] as const) {
      expect(computeTripStatus({ status, endDate: '2026-11-01' }, '2026-11-21')).toBeNull();
    }
  });

  it('đơn không có mục thì không có trạng thái chuyến', () => {
    expect(computeTripStatus({ status: 'paid', endDate: null }, '2026-11-21')).toBeNull();
  });
});

describe('findEndDate', () => {
  it('đơn nhiều mục lấy ngày muộn nhất: khách sạn + vé bay về', () => {
    expect(findEndDate([{ dateTo: '2026-12-03' }, { dateTo: '2026-12-01' }, { dateTo: '2026-12-05' }])).toBe('2026-12-05');
  });

  it('không có mục thì null', () => {
    expect(findEndDate([])).toBeNull();
  });
});

describe('computeTripStartAt / isDueForDepartureReminder', () => {
  it('phòng tính từ 14:00 giờ Việt Nam, vé bay theo giờ cất cánh; lấy mốc sớm nhất', () => {
    expect(computeTripStartAt([{ productType: 'room', date: '2026-12-01' }])?.toISOString()).toBe('2026-12-01T07:00:00.000Z');
    expect(
      computeTripStartAt([
        { productType: 'room', date: '2026-12-01' },
        { productType: 'flight', date: '2026-12-01', departTime: '06:30' },
      ])?.toISOString(),
    ).toBe('2026-11-30T23:30:00.000Z');
  });

  it('vé bay thiếu hoặc sai giờ thì lấy 00:00 giờ Việt Nam', () => {
    expect(computeTripStartAt([{ productType: 'flight', date: '2026-12-01', departTime: null }])?.toISOString()).toBe('2026-11-30T17:00:00.000Z');
    expect(computeTripStartAt([{ productType: 'flight', date: '2026-12-01', departTime: '25:99' }])?.toISOString()).toBe('2026-11-30T17:00:00.000Z');
    expect(computeTripStartAt([])).toBeNull();
  });

  it('chỉ nhắc khi còn trong 24 giờ và chuyến chưa bắt đầu', () => {
    const startAt = new Date('2026-12-01T07:00:00Z');
    expect(isDueForDepartureReminder(startAt, new Date('2026-11-30T06:59:59Z'))).toBe(false);
    expect(isDueForDepartureReminder(startAt, new Date('2026-11-30T07:00:00Z'))).toBe(true);
    expect(isDueForDepartureReminder(startAt, new Date('2026-12-01T06:59:00Z'))).toBe(true);
    expect(isDueForDepartureReminder(startAt, new Date('2026-12-01T07:00:00Z'))).toBe(false);
  });
});
