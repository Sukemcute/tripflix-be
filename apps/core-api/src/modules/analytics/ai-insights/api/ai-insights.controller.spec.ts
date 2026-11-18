import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { AiInsightsQueries } from '../application/ai-insights-queries.use-cases.js';
import { AiInsightsController } from './ai-insights.controller.js';

const turn = '55555555-5555-4555-8555-555555555555';
const user = '11111111-1111-4111-8111-111111111111';
const at = new Date('2026-11-18T10:20:00.000Z');
const trace = {
  eventId: 'e1',
  turnId: turn,
  userId: user,
  occurredAt: at,
  question: 'tour Huế',
  intent: 'search',
  answerKind: 'answer',
  isAction: false,
  latencyMs: 900,
  steps: 2,
  inputTokens: 100,
  outputTokens: 10,
  costUsd: 0.001,
  displayName: 'An',
  email: 'an@example.com',
};

const controllerWith = (queries: Partial<AiInsightsQueries>) => new AiInsightsController(queries as AiInsightsQueries);

describe('AiInsightsController', () => {
  it('biểu đồ trả thời gian dạng ISO', async () => {
    const controller = controllerWith({ timeseries: async () => [{ at, calls: 1, inputTokens: 2, outputTokens: 3, costUsd: 0.1 }] });

    const response = await controller.timeseries({ from: '2026-11-17', to: '2026-11-18' });

    expect(response.bucket).toBe('day');
    expect(response.points[0]).toMatchObject({ at: '2026-11-18T10:20:00.000Z', calls: 1 });
  });

  it('bucket giờ quá 8 ngày, khoảng quá 92 ngày hoặc feature lạ thì 400', async () => {
    const controller = controllerWith({ timeseries: async () => [] });

    await expect(controller.timeseries({ from: '2026-11-01', to: '2026-11-18', bucket: 'hour' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.timeseries({ from: '2026-01-01', to: '2026-11-18' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.timeseries({ feature: 'khac' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('xếp hạng người dùng đổi lastAt sang ISO và nhận userId lọc', async () => {
    let received: unknown;
    const controller = controllerWith({
      users: async (query) => {
        received = query;
        return {
          total: 1,
          items: [{ userId: user, calls: 1, conversations: 1, inputTokens: 1, outputTokens: 1, costUsd: 0, lastAt: at, displayName: 'An', email: 'an@example.com' }],
        };
      },
    });

    const response = await controller.users({ userId: user });

    expect(response.items[0]).toMatchObject({ lastAt: '2026-11-18T10:20:00.000Z', email: 'an@example.com' });
    expect(received).toMatchObject({ userId: user, page: 1, pageSize: 20 });
    await expect(controller.users({ userId: 'khong-phai-uuid' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('danh sách trace nhận answerKind, minCostUsd và trả ISO', async () => {
    let received: unknown;
    const controller = controllerWith({
      traces: async (query) => {
        received = query;
        return { total: 1, items: [trace] };
      },
    });

    const response = await controller.traces({ answerKind: 'error', minCostUsd: '0.5' });

    expect(response.items[0]).toMatchObject({ occurredAt: '2026-11-18T10:20:00.000Z', turnId: turn });
    expect(received).toMatchObject({ answerKind: 'error', minCostUsd: 0.5 });
  });

  it('chi tiết trace: 400 khi turnId sai dạng, 404 khi không có, ngược lại trả các bước', async () => {
    const steps = [
      { id: 's1', step: 'responder', model: 'm', inputTokens: 1, outputTokens: 1, costUsd: 0, latencyMs: 5, occurredAt: at, isEstimated: true },
    ];
    const controller = controllerWith({ trace: async (id) => (id === turn ? { trace, steps } : null) });

    await expect(controller.trace('abc')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.trace('66666666-6666-4666-8666-666666666666')).rejects.toBeInstanceOf(NotFoundException);
    const response = await controller.trace(turn);
    expect(response.steps[0]).toMatchObject({ occurredAt: '2026-11-18T10:20:00.000Z', step: 'responder' });
  });
});
