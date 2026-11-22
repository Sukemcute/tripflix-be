import 'reflect-metadata';
import { Body, Controller, HttpCode, type INestApplication, Inject, Injectable, Module, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { IN_PROGRESS_MESSAGE, Idempotent, IdempotencyModule, KEY_REUSED_MESSAGE, MISSING_KEY_MESSAGE } from './interceptor.js';
import { MemoryIdempotencyStore } from './store.js';

@Injectable()
class OrderCounter {
  callCount = 0;
  gate: Promise<void> = Promise.resolve();
  shouldFail = false;
}

@Controller('orders')
class OrdersController {
  constructor(@Inject(OrderCounter) private readonly counter: OrderCounter) {}

  @Post()
  @Idempotent()
  async create(@Body() body: { amount: number }) {
    this.counter.callCount += 1;
    await this.counter.gate;
    if (this.counter.shouldFail) throw new Error('thanh toán lỗi');
    return { orderNumber: this.counter.callCount, amount: body.amount };
  }

  @Post('pay')
  @HttpCode(200)
  @Idempotent()
  pay() {
    this.counter.callCount += 1;
    return { paid: true };
  }
}

const store = new MemoryIdempotencyStore();

@Module({
  imports: [IdempotencyModule.forFeature({ useFactory: () => store })],
  controllers: [OrdersController],
  providers: [OrderCounter],
})
class OrdersModule {}

describe('@Idempotent()', () => {
  let app: INestApplication;
  let counter: OrderCounter;
  const post = (path: string, key: string | undefined, body: unknown) => {
    const req = request(app.getHttpServer()).post(path).send(body as object);
    return key ? req.set('Idempotency-Key', key) : req;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [OrdersModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    counter = moduleRef.get(OrderCounter);
  });

  beforeEach(() => {
    counter.callCount = 0;
    counter.gate = Promise.resolve();
    counter.shouldFail = false;
  });

  afterAll(async () => {
    await app.close();
  });

  it('thiếu header Idempotency-Key thì 400 và không xử lý', async () => {
    const res = await post('/orders', undefined, { amount: 100 }).expect(400);
    expect(res.body.message).toBe(MISSING_KEY_MESSAGE);
    expect(counter.callCount).toBe(0);
  });

  it('gửi lại cùng key: trả đúng kết quả cũ, chỉ xử lý một lần', async () => {
    const first = await post('/orders', 'key-replay', { amount: 100 }).expect(201);
    const again = await post('/orders', 'key-replay', { amount: 100 }).expect(201);
    expect(again.body).toEqual(first.body);
    expect(again.headers['idempotency-replayed']).toBe('true');
    expect(counter.callCount).toBe(1);
  });

  it('giữ đúng mã trạng thái của @HttpCode khi trả lại', async () => {
    await post('/orders/pay', 'key-pay', {}).expect(200);
    await post('/orders/pay', 'key-pay', {}).expect(200);
    expect(counter.callCount).toBe(1);
  });

  it('cùng nội dung nhưng khác thứ tự khoá vẫn coi là một yêu cầu', async () => {
    await post('/orders', 'key-order', { amount: 5, note: 'a' }).expect(201);
    await post('/orders', 'key-order', { note: 'a', amount: 5 }).expect(201);
    expect(counter.callCount).toBe(1);
  });

  it('cùng key nhưng nội dung khác thì 422', async () => {
    await post('/orders', 'key-diff', { amount: 100 }).expect(201);
    const res = await post('/orders', 'key-diff', { amount: 999 }).expect(422);
    expect(res.body.message).toBe(KEY_REUSED_MESSAGE);
    expect(counter.callCount).toBe(1);
  });

  it('lần đầu chưa xong mà gửi lại thì 409', async () => {
    let release!: () => void;
    counter.gate = new Promise((resolve) => (release = resolve));
    const first = post('/orders', 'key-slow', { amount: 1 }).then((r) => r);
    await vi.waitFor(() => expect(counter.callCount).toBe(1));
    const second = await post('/orders', 'key-slow', { amount: 1 }).expect(409);
    expect(second.body.message).toBe(IN_PROGRESS_MESSAGE);
    release();
    expect((await first).status).toBe(201);
    expect(counter.callCount).toBe(1);
  });

  it('xử lý lỗi thì xoá chỗ đã giữ, gửi lại cùng key được xử lý lại', async () => {
    counter.shouldFail = true;
    await post('/orders', 'key-fail', { amount: 1 }).expect(500);
    counter.shouldFail = false;
    await post('/orders', 'key-fail', { amount: 1 }).expect(201);
    expect(counter.callCount).toBe(2);
  });
});
