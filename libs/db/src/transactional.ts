import {
  ClsPluginTransactional,
  InjectTransactionHost as injectClsTransactionHost,
  NoOpTransactionalAdapter,
  Transactional as clsTransactional,
  getTransactionHostToken,
  type TransactionHost,
} from '@nestjs-cls/transactional';
import { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
import type { ModuleMetadata } from '@nestjs/common';
import { MODULES, type Db, type ModuleName } from './index.js';

/** Adapter transaction của một module: Drizzle trên kết nối (user Postgres) riêng của module đó. */
export type DbTransactionalAdapter = TransactionalAdapterDrizzleOrm<Db>;
/** `txHost.tx` là transaction đang mở của module, hoặc kết nối thường khi không có transaction. */
export type ModuleTransactionHost = TransactionHost<DbTransactionalAdapter>;

/** Token Nest của instance Drizzle theo module; platform của app cung cấp giá trị. */
export const buildDrizzleToken = (module: ModuleName): symbol => Symbol.for(`tripflix:drizzle:${module}`);

/**
 * Mỗi module một ClsPluginTransactional có connectionName riêng (docs/architecture/11 §3.3), nên
 * use case của content không thể mở transaction trên kết nối của commerce.
 * `imports` phải chứa module cung cấp các token buildDrizzleToken(module).
 */
export function createTransactionalPlugins(imports: ModuleMetadata['imports']): ClsPluginTransactional[] {
  return MODULES.map(
    (module) =>
      new ClsPluginTransactional({
        connectionName: module,
        imports,
        adapter: new TransactionalAdapterDrizzleOrm<Db>({ drizzleInstanceToken: buildDrizzleToken(module) }),
      }),
  );
}

/**
 * Mở transaction trên kết nối của module cho cả hàm. Chỉ dùng ở use case trong application/ (RULES §10).
 * Không gọi dịch vụ ngoài (thanh toán, AI, S3, gửi thông báo) bên trong hàm có decorator này.
 */
export const Transactional = (module: ModuleName): MethodDecorator => clsTransactional<DbTransactionalAdapter>(module);

/** Tiêm TransactionHost của module vào repository: `@InjectTransactionHost('access') txHost: ModuleTransactionHost`. */
export const InjectTransactionHost = (module: ModuleName): PropertyDecorator & ParameterDecorator =>
  injectClsTransactionHost(module);

/** Token Nest của TransactionHost theo module, dùng trong `inject: [...]` của provider factory. */
export const buildTransactionHostToken = (module: ModuleName) => getTransactionHostToken(module);

/**
 * Plugin transaction không làm gì, cho test dùng store bộ nhớ: @Transactional vẫn chạy được
 * nhưng không mở transaction database nào.
 */
export function createNoOpTransactionalPlugins(): ClsPluginTransactional[] {
  return MODULES.map(
    (module) =>
      new ClsPluginTransactional({
        connectionName: module,
        adapter: new NoOpTransactionalAdapter({ tx: {}, disableWarning: true }),
      }),
  );
}
