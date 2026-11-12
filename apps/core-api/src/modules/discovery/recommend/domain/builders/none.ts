import { z } from 'zod';
import type { UserBuilder } from '../contracts.js';

/** none@v0: không có gu người dùng (dùng cho trending). */
export const noneV0: UserBuilder = {
  key: 'none@v0',
  featuresSchema: z.object({}).strict(),
  build: (items) => Promise.resolve(items.map((item) => ({ userId: item.userId, features: {} }))),
};
