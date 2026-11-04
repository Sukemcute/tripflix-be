import 'reflect-metadata';
import { Global, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import { MODULES, type Db } from './index.js';
import {
  InjectTransactionHost,
  Transactional,
  buildDrizzleToken,
  createTransactionalPlugins,
  type ModuleTransactionHost,
} from './transactional.js';

// Drizzle giả: transaction(fn) gọi fn với một đối tượng tx riêng và ghi lại số lần mở.
function createFakeDrizzle(name: string) {
  const opened: string[] = [];
  const base = { name: `${name}-base` } as Record<string, unknown>;
  base.transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    opened.push(name);
    return fn({ name: `${name}-tx` });
  };
  return { db: base as unknown as Db, opened };
}

const fakes = Object.fromEntries(MODULES.map((m) => [m, createFakeDrizzle(m)]));

@Global()
@Module({
  providers: MODULES.map((m) => ({ provide: buildDrizzleToken(m), useValue: fakes[m]!.db })),
  exports: MODULES.map((m) => buildDrizzleToken(m)),
})
class FakeDrizzleModule {}

@Injectable()
class AccessUseCase {
  constructor(
    @InjectTransactionHost('access') private readonly accessTx: ModuleTransactionHost,
    @InjectTransactionHost('commerce') private readonly commerceTx: ModuleTransactionHost,
  ) {}

  @Transactional('access')
  async runInAccessTransaction() {
    return { access: this.accessTx.tx, commerce: this.commerceTx.tx };
  }

  readOutsideTransaction() {
    return this.accessTx.tx;
  }

  @Transactional('access')
  async failInsideTransaction(): Promise<never> {
    throw new Error('lỗi nghiệp vụ');
  }
}

describe('Transactional(module)', () => {
  let useCase: AccessUseCase;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        FakeDrizzleModule,
        ClsModule.forRoot({ global: true, plugins: createTransactionalPlugins([FakeDrizzleModule]) }),
      ],
      providers: [AccessUseCase],
    }).compile();
    await moduleRef.init();
    useCase = moduleRef.get(AccessUseCase);
  });

  it('trong hàm có @Transactional, txHost.tx là transaction của đúng module', async () => {
    const result = await useCase.runInAccessTransaction();
    expect(result.access).toEqual({ name: 'access-tx' });
    expect(fakes.access!.opened).toContain('access');
  });

  it('transaction của access không lẫn sang kết nối của commerce', async () => {
    const result = await useCase.runInAccessTransaction();
    expect((result.commerce as unknown as { name: string }).name).toBe('commerce-base');
    expect(fakes.commerce!.opened).toHaveLength(0);
  });

  it('ngoài transaction, txHost.tx là kết nối thường', () => {
    expect((useCase.readOutsideTransaction() as unknown as { name: string }).name).toBe('access-base');
  });

  it('lỗi trong hàm được ném ra để transaction rollback', async () => {
    await expect(useCase.failInsideTransaction()).rejects.toThrow('lỗi nghiệp vụ');
  });
});
