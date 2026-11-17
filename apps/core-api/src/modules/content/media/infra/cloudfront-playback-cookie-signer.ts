import { getSignedCookies } from '@aws-sdk/cloudfront-signer';
import type { PlaybackCookieSigner } from '../application/ports.js';

/** Ký cookie CloudFront bằng khoá riêng RSA của key group gắn vào behavior video. */
export class CloudFrontPlaybackCookieSigner implements PlaybackCookieSigner {
  constructor(private readonly credentials: { keyPairId: string; privateKeyPem: string }) {}

  signCookies(policy: string): Record<string, string> {
    const signed = getSignedCookies({
      keyPairId: this.credentials.keyPairId,
      privateKey: this.credentials.privateKeyPem,
      policy,
    });
    // Bỏ trường không có giá trị (CloudFront-Expires chỉ có ở canned policy) để app ghép header Cookie gọn.
    return Object.fromEntries(
      Object.entries(signed).flatMap(([name, value]) => (value === undefined ? [] : [[name, String(value)]])),
    );
  }
}
