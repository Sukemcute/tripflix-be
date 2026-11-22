import { defineConfig } from 'vitest/config';

// pnpm test:int: test chạy với Postgres, Redis thật trong Docker (Testcontainers). Cần Docker đang chạy.
export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.int.spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // Không tải image ryuk (dọn container); afterAll tự dừng container.
    env: { TESTCONTAINERS_RYUK_DISABLED: 'true' },
  },
});
