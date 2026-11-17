import { createVerify, generateKeyPairSync } from 'node:crypto';
import { buildPlaybackPolicy } from '../domain/playback-policy.js';
import { CloudFrontPlaybackCookieSigner } from './cloudfront-playback-cookie-signer.js';

/** CloudFront đổi base64 sang dạng an toàn trong cookie: + thành -, = thành _, / thành ~. */
function decodeCloudFrontBase64(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '=').replace(/~/g, '/'), 'base64');
}

describe('CloudFrontPlaybackCookieSigner', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const signer = new CloudFrontPlaybackCookieSigner({
    keyPairId: 'K2TESTKEY',
    privateKeyPem: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
  });
  const policy = buildPlaybackPolicy('https://media.test/*', new Date('2026-11-17T12:00:00.000Z'));

  it('trả đủ 3 cookie của custom policy, không có CloudFront-Expires', () => {
    const cookies = signer.signCookies(policy);
    expect(Object.keys(cookies).sort()).toEqual(['CloudFront-Key-Pair-Id', 'CloudFront-Policy', 'CloudFront-Signature']);
    expect(cookies['CloudFront-Key-Pair-Id']).toBe('K2TESTKEY');
    expect(decodeCloudFrontBase64(cookies['CloudFront-Policy']!).toString('utf8')).toBe(policy);
  });

  it('chữ ký kiểm được bằng public key, như CloudFront kiểm', () => {
    const cookies = signer.signCookies(policy);
    const isValid = createVerify('RSA-SHA1')
      .update(policy)
      .verify(publicKey, decodeCloudFrontBase64(cookies['CloudFront-Signature']!));
    expect(isValid).toBe(true);
  });
});
