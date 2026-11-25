import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { gunzipSync, gzipSync } from 'node:zlib';
import { PHRASE_NS } from '../domain/explore/stats.js';
import type { CountRow } from '../domain/explore/types.js';

const STATS_VER_KEY = 'discovery:explore:stats:ver';
const STATS_DATA_KEY = 'discovery:explore:stats:v1';
const CHECK_INTERVAL_MS = 30_000;
const STATS_TTL_SEC = 7 * 24 * 3600;
const PHRASE_NS_SET = new Set(PHRASE_NS);

interface PhraseEntry {
  term: string;
  noSpaceLen: number;
}

/**
 * Bộ đếm chỉ mục (`df`, `ngram`, `street`, `brand`, `tgram`, `clat`, `clon`) giữ trên RAM để `understand()`
 * và `vocabGaps()` chạy trong < 0,2 ms mà không tốn câu SQL nào; đồng bộ giữa worker -> api qua Redis gzip.
 */
export class ExploreStatsCache {
  private readonly logger = new Logger(ExploreStatsCache.name);
  private loaded = false;
  private loadedVersion: string | null = null;
  private lastCheckedAt = 0;
  private refreshPromise: Promise<void> | null = null;

  private values = new Map<string, number>();
  private typoByFirst = new Map<string, Array<{ term: string; df: number }>>();
  private phraseByFirst = new Map<string, PhraseEntry[]>();

  constructor(
    private readonly redis: Pick<Redis, 'get' | 'set'>,
    private readonly fallbackLoader?: () => Promise<CountRow[]>,
    private readonly now: () => number = Date.now,
  ) {}

  async save(rows: readonly CountRow[]): Promise<void> {
    this.applyRows(rows);
    const version = `${this.now()}-${rows.length}`;
    this.loaded = true;
    this.loadedVersion = version;
    this.lastCheckedAt = this.now();
    try {
      const gz = gzipSync(Buffer.from(JSON.stringify(rows), 'utf8')).toString('base64');
      await Promise.all([
        this.redis.set(STATS_DATA_KEY, gz, 'EX', STATS_TTL_SEC),
        this.redis.set(STATS_VER_KEY, version, 'EX', STATS_TTL_SEC),
      ]);
    } catch (err) {
      this.logger.warn(`Không ghi được snapshot ExploreStatsCache lên Redis: ${(err as Error).message}`);
    }
  }

  async ensureFresh(): Promise<void> {
    if (this.loaded && this.now() - this.lastCheckedAt < CHECK_INTERVAL_MS) return;
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    await this.refreshPromise;
  }

  async counts(keys: ReadonlyArray<{ ns: string; key: string }>): Promise<CountRow[]> {
    if (!keys.length) return [];
    await this.ensureFresh();
    const out: CountRow[] = [];
    for (const k of keys) {
      const n = this.values.get(`${k.ns}\u0000${k.key}`);
      if (n !== undefined) out.push({ ...k, n });
    }
    return out;
  }

  async typoPool(first: string, minLen: number, maxLen: number): Promise<Array<{ term: string; df: number }>> {
    await this.ensureFresh();
    return (this.typoByFirst.get(first) ?? []).filter((r) => r.term.length >= minLen && r.term.length <= maxLen);
  }

  async phrasePool(first: string, minLen: number, maxLen: number): Promise<string[]> {
    await this.ensureFresh();
    return (this.phraseByFirst.get(first) ?? [])
      .filter((r) => r.noSpaceLen >= minLen && r.noSpaceLen <= maxLen)
      .map((r) => r.term);
  }

  private async doRefresh(): Promise<void> {
    try {
      const ver = await this.redis.get(STATS_VER_KEY);
      if (ver && ver === this.loadedVersion) {
        this.lastCheckedAt = this.now();
        return;
      }
      if (ver) {
        const raw = await this.redis.get(STATS_DATA_KEY);
        if (raw) {
          const rows = JSON.parse(gunzipSync(Buffer.from(raw, 'base64')).toString('utf8')) as CountRow[];
          this.applyRows(rows);
          this.loaded = true;
          this.loadedVersion = ver;
          this.lastCheckedAt = this.now();
          return;
        }
      }
    } catch (err) {
      this.logger.warn(`Đọc ExploreStatsCache từ Redis lỗi: ${(err as Error).message}`);
    }

    if (!this.loaded && this.fallbackLoader) {
      try {
        const rows = await this.fallbackLoader();
        this.applyRows(rows);
        this.loaded = true;
        this.lastCheckedAt = this.now();
      } catch (err) {
        this.logger.warn(`Nạp fallback ExploreStatsCache từ DB lỗi: ${(err as Error).message}`);
      }
    } else if (this.loaded) {
      this.lastCheckedAt = this.now();
    }
  }

  private applyRows(rows: readonly CountRow[]): void {
    const values = new Map<string, number>();
    const typoByFirst = new Map<string, Array<{ term: string; df: number }>>();
    const phraseSeen = new Set<string>();
    const phraseByFirst = new Map<string, PhraseEntry[]>();

    for (const r of rows) {
      values.set(`${r.ns}\u0000${r.key}`, r.n);
      if (r.ns === 'df' && r.key && !r.key.includes('_') && r.key[0] !== '#') {
        const first = r.key[0]!;
        const list = typoByFirst.get(first) ?? [];
        list.push({ term: r.key, df: r.n });
        typoByFirst.set(first, list);
      } else if (PHRASE_NS_SET.has(r.ns) && r.key.includes(' ') && !phraseSeen.has(r.key)) {
        phraseSeen.add(r.key);
        const first = r.key[0]!;
        const list = phraseByFirst.get(first) ?? [];
        list.push({ term: r.key, noSpaceLen: r.key.split(' ').join('').length });
        phraseByFirst.set(first, list);
      }
    }

    this.values = values;
    this.typoByFirst = typoByFirst;
    this.phraseByFirst = phraseByFirst;
  }
}
