import { checkServiceClientInput } from './service-client-rules.js';

describe('checkServiceClientInput', () => {
  const check = (clientId: string, audiences: string[]) => checkServiceClientInput({ clientId, audiences }, 'tripflix');

  it('nhận tên chữ thường, số, gạch nối', () => {
    expect(check('ai-service', ['core-api', 'notification-service'])).toBeNull();
    expect(check('video-worker2', ['core-api'])).toBeNull();
  });

  it('từ chối clientId, audience sai dạng', () => {
    expect(check('AI', ['core-api'])).toMatch(/clientId/);
    expect(check('1service', ['core-api'])).toMatch(/clientId/);
    expect(check('ai_service', ['core-api'])).toMatch(/clientId/);
    expect(check('ai-service', ['Core API'])).toMatch(/audience/);
  });

  it('cần ít nhất một audience, không được trùng aud của token người dùng', () => {
    expect(check('ai-service', [])).toMatch(/ít nhất/);
    expect(check('ai-service', ['core-api', 'tripflix'])).toMatch(/trùng aud/);
  });
});
