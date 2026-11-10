import { z } from 'zod';
import type { ModerationAiPort, ModerationItem } from '../application/ports.js';
import type { AiVerdict } from '../domain/severity.js';

const TokenSchema = z.object({
  accessToken: z.string().min(1),
  expiresIn: z.number().positive(),
  tokenType: z.literal('Bearer'),
});
const ResponseSchema = z.object({
  model: z.string().min(1),
  results: z.array(
    z.object({
      id: z.string(),
      flagged: z.boolean(),
      categories: z.record(z.string(), z.boolean()),
      scores: z.record(z.string(), z.number().min(0).max(1)),
    }),
  ),
});
export interface AiClientConfig {
  aiUrl?: string;
  coreUrl?: string;
  secret?: string;
  timeoutMs?: number;
}

export class AiModerationClient implements ModerationAiPort {
  private token: { value: string; expiresAt: number } | undefined;
  private pendingToken: Promise<string> | undefined;
  constructor(
    private readonly config: AiClientConfig,
    private readonly request: typeof fetch = fetch,
    private readonly now = Date.now,
  ) {}

  async moderate(items: ModerationItem[]): Promise<AiVerdict[] | null> {
    if (!this.config.aiUrl || !this.config.coreUrl || !this.config.secret) return null;
    try {
      const output: AiVerdict[] = [];
      for (let offset = 0; offset < items.length; offset += 20) {
        const batch = items.slice(offset, offset + 20).map((item) => ({
          id: item.id,
          text: Array.from(item.text).slice(0, 10_000).join(''),
          imageUrls: item.imageUrls
            .filter((url) => {
              try {
                return new URL(url).protocol === 'https:';
              } catch {
                return false;
              }
            })
            .slice(0, 4),
        }));
        if (batch.some((item) => !item.text.trim() && !item.imageUrls.length)) return null;
        let token = await this.getToken();
        let response = await this.call(batch, token);
        if (response.status === 401) {
          if (this.token?.value === token) this.token = undefined;
          token = await this.getToken();
          response = await this.call(batch, token);
        }
        if (!response.ok) return null;
        const parsed = ResponseSchema.parse(await response.json());
        if (
          parsed.results.length !== batch.length ||
          parsed.results.some((result, index) => result.id !== batch[index]?.id)
        )
          return null;
        output.push(...parsed.results.map((result) => ({ ...result, model: parsed.model })));
      }
      return output;
    } catch {
      // Lỗi AI là nhánh fail-open đã chốt; lỗi DB/outbox ở use case vẫn ném ra cho consumer retry.
      return null;
    }
  }

  private call(items: ModerationItem[], token: string) {
    return this.request(`${this.config.aiUrl!.replace(/\/$/, '')}/moderate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ items }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 3000),
    });
  }
  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) return this.token.value;
    if (this.pendingToken) return this.pendingToken;
    this.pendingToken = this.issueToken();
    try {
      return await this.pendingToken;
    } finally {
      this.pendingToken = undefined;
    }
  }
  private async issueToken(): Promise<string> {
    const response = await this.request(`${this.config.coreUrl!.replace(/\/$/, '')}/api/auth/service-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'core-api',
        audience: 'ai-service',
        clientSecret: this.config.secret,
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 3000),
    });
    if (!response.ok) throw new Error('Không lấy được service token kiểm duyệt');
    const token = TokenSchema.parse(await response.json());
    this.token = {
      value: token.accessToken,
      expiresAt: this.now() + Math.max(0, token.expiresIn - 60) * 1000,
    };
    return token.accessToken;
  }
}
