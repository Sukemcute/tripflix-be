import { z } from 'zod';
import type { TextEmbedder } from '../application/ports.js';

const TokenSchema = z.object({ accessToken: z.string().min(1), expiresIn: z.number().positive(), tokenType: z.literal('Bearer') });
const EmbedResponseSchema = z.object({ model: z.string().min(1), vectors: z.array(z.array(z.number())) });

/** Giới hạn của ai-service POST /embed. */
const BATCH = 64;

export interface AiEmbeddingConfig {
  aiUrl?: string;
  coreUrl?: string;
  /** Secret của client `core-api` (audience ai-service), dùng chung với kiểm duyệt. */
  secret?: string;
  timeoutMs?: number;
}

/**
 * Client ai-service POST /embed cho job gợi ý (TF28). Lỗi gì cũng trả null: job bỏ nguồn caption, không hỏng.
 * ponytail: phần xin service token chép từ content/moderation AiModerationClient (không được import chéo module);
 * gom vào libs khi có service thứ ba gọi ai-service.
 */
export class AiEmbeddingClient implements TextEmbedder {
  private token: { value: string; expiresAt: number } | undefined;

  constructor(
    private readonly config: AiEmbeddingConfig,
    private readonly request: typeof fetch = fetch,
    private readonly now = Date.now,
  ) {}

  async embed(texts: string[]): Promise<{ model: string; vectors: number[][] } | null> {
    const { aiUrl, coreUrl, secret } = this.config;
    if (!aiUrl || !coreUrl || !secret || texts.length === 0) return null;
    try {
      let model = '';
      const vectors: number[][] = [];
      for (let offset = 0; offset < texts.length; offset += BATCH) {
        const batch = texts.slice(offset, offset + BATCH);
        let response = await this.call(batch, await this.getToken());
        if (response.status === 401) {
          this.token = undefined;
          response = await this.call(batch, await this.getToken());
        }
        if (!response.ok) return null;
        const parsed = EmbedResponseSchema.parse(await response.json());
        if (parsed.vectors.length !== batch.length || (model && parsed.model !== model)) return null;
        model = parsed.model;
        vectors.push(...parsed.vectors);
      }
      return { model, vectors };
    } catch {
      return null;
    }
  }

  private call(texts: string[], token: string) {
    return this.request(`${this.config.aiUrl!.replace(/\/$/, '')}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
    });
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) return this.token.value;
    const response = await this.request(`${this.config.coreUrl!.replace(/\/$/, '')}/api/auth/service-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'core-api', audience: 'ai-service', clientSecret: this.config.secret }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
    });
    if (!response.ok) throw new Error('Không lấy được service token cho ai-service');
    const token = TokenSchema.parse(await response.json());
    this.token = { value: token.accessToken, expiresAt: this.now() + Math.max(0, token.expiresIn - 60) * 1000 };
    return token.accessToken;
  }
}
