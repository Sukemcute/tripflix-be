import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ACCESS_STORE, CLOCK, PASSWORD_HASHER, type AccessStore, type Clock, type PasswordHasher } from '../modules/access/index.js';

export async function prepareTestRegistration(app: INestApplication, email: string) {
  const code = '48162357';
  const registrationId = randomUUID();
  const codeHash = await app.get<PasswordHasher>(PASSWORD_HASHER).hash(code);
  await app.get<AccessStore>(ACCESS_STORE).registrationChallenges.save({
    email: email.trim().toLowerCase(),
    id: registrationId,
    codeHash,
    expiresAt: new Date(app.get<Clock>(CLOCK)().getTime() + 60_000),
  });
  return { registrationId, code };
}

export async function registerTestAccount(
  app: INestApplication,
  input: { email: string; password: string; displayName: string } & Record<string, unknown>,
  status = 201,
  headers: Record<string, string> = {},
): Promise<request.Response> {
  const proof = await prepareTestRegistration(app, input.email);
  return request(app.getHttpServer()).post('/api/auth/register').set(headers).send({ ...input, ...proof }).expect(status);
}

/** Fixture cho tài khoản đã được tạo trước luồng đăng ký bằng mã. */
export async function seedLegacyAccount(
  app: INestApplication,
  input: { email: string; password: string; displayName: string },
) {
  const passwordHash = await app.get<PasswordHasher>(PASSWORD_HASHER).hash(input.password);
  const user = await app.get<AccessStore>(ACCESS_STORE).users.insert({
    email: input.email,
    displayName: input.displayName,
    passwordHash,
    role: 'member',
  });
  if (!user) throw new Error('Could not create legacy test user');
  return user;
}
