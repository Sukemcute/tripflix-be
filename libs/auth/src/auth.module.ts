import { type DynamicModule, Global, Module, type ModuleMetadata } from '@nestjs/common';
import { AUTH_VERIFIER, AccessTokenGuard, RolesGuard, SID_BLOCKLIST } from './guards.js';
import type { SidBlocklist } from './revocation.js';
import type { AccessTokenVerifier } from './verifier.js';

export interface AuthModuleOptions {
  verifier: AccessTokenVerifier;
  blocklist: SidBlocklist;
}

export interface AuthModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  inject?: (string | symbol | (abstract new (...args: never[]) => unknown))[];
  useFactory: (...args: never[]) => AuthModuleOptions | Promise<AuthModuleOptions>;
}

const OPTIONS = Symbol('AUTH_MODULE_OPTIONS');

/** Cấp AccessTokenGuard, RolesGuard cho cả app. Mỗi app gọi forRootAsync một lần. */
@Global()
@Module({})
export class AuthModule {
  static forRootAsync({ imports, inject, useFactory }: AuthModuleAsyncOptions): DynamicModule {
    return {
      module: AuthModule,
      imports,
      providers: [
        { provide: OPTIONS, inject: inject ?? [], useFactory },
        { provide: AUTH_VERIFIER, inject: [OPTIONS], useFactory: (o: AuthModuleOptions) => o.verifier },
        { provide: SID_BLOCKLIST, inject: [OPTIONS], useFactory: (o: AuthModuleOptions) => o.blocklist },
        AccessTokenGuard,
        RolesGuard,
      ],
      exports: [AUTH_VERIFIER, SID_BLOCKLIST, AccessTokenGuard, RolesGuard],
    };
  }
}
