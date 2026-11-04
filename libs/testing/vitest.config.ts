import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.spec.ts'],
    // *.int.spec.ts cần Docker, chạy riêng bằng pnpm test:int.
    exclude: ['src/**/*.int.spec.ts'],
  },
});
