import { MediaPlaybackUseCases } from './media-playback.use-cases.js';
import type { PlaybackCookieSigner, PlaybackSettings } from './ports.js';

const NOW = new Date('2026-11-17T06:00:00.000Z');
const SETTINGS: PlaybackSettings = { cdnBaseUrl: 'https://media.test/', ttlSec: 3600, cookieDomain: '.test' };

class RecordingSigner implements PlaybackCookieSigner {
  policies: string[] = [];
  signCookies(policy: string) {
    this.policies.push(policy);
    return { 'CloudFront-Signature': 'sig' };
  }
}

describe('MediaPlaybackUseCases', () => {
  it('ký mọi file dưới gốc CDN, hết hạn sau ttlSec', () => {
    const signer = new RecordingSigner();
    const session = new MediaPlaybackUseCases(signer, SETTINGS, () => NOW).createSession();

    expect(session).toEqual({ cookies: { 'CloudFront-Signature': 'sig' }, expiresAt: '2026-11-17T07:00:00.000Z' });
    expect(JSON.parse(signer.policies[0]!)).toEqual({
      Statement: [
        { Resource: 'https://media.test/*', Condition: { DateLessThan: { 'AWS:EpochTime': NOW.getTime() / 1000 + 3600 } } },
      ],
    });
  });

  it('chưa cấu hình khoá thì không ký, video phát như cũ', () => {
    expect(new MediaPlaybackUseCases(null, SETTINGS, () => NOW).createSession()).toEqual({ cookies: {}, expiresAt: null });
  });

  it('chưa có MEDIA_CDN_URL thì không ký, vì không biết ký cho đường dẫn nào', () => {
    const signer = new RecordingSigner();
    const session = new MediaPlaybackUseCases(signer, { ...SETTINGS, cdnBaseUrl: '' }, () => NOW).createSession();
    expect(session).toEqual({ cookies: {}, expiresAt: null });
    expect(signer.policies).toEqual([]);
  });
});
