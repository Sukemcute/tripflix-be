import { Logger } from '@nestjs/common';

export interface TypesenseClientConfig {
  host: string;
  port: number;
  protocol: 'http' | 'https';
  apiKey: string;
  timeoutMs?: number;
}

export interface TypesenseFieldSchema {
  name: string;
  type: string;
  facet?: boolean;
  optional?: boolean;
  index?: boolean;
  locale?: string;
}

export interface TypesenseCollectionSchema {
  name: string;
  fields: TypesenseFieldSchema[];
  default_sorting_field?: string;
}

export interface TypesenseSynonymPayload {
  root?: string;
  synonyms: string[];
}

export interface TypesenseSearchRequest {
  collection?: string;
  q: string;
  query_by?: string;
  query_by_weights?: string;
  text_match_type?: string;
  drop_tokens_threshold?: number;
  num_typos?: number;
  filter_by?: string;
  sort_by?: string;
  per_page?: number;
  page?: number;
  include_fields?: string;
  exclude_fields?: string;
}

export interface TypesenseSearchHit<T> {
  document: T;
  text_match?: number;
}

export interface TypesenseSearchResult<T> {
  found?: number;
  hits?: Array<TypesenseSearchHit<T>>;
  error?: string;
  code?: number;
}

export class TypesenseError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'TypesenseError';
  }
}

const IMPORT_CHUNK = 1_000;
const DELETE_CHUNK = 200;
const MULTI_SEARCH_CHUNK = 40;
const DEFAULT_TIMEOUT_MS = 3_000;
const BULK_TIMEOUT_MS = 30_000;

export const escapeTypesenseFilterValue = (value: string): string => `\`${value.replace(/`/g, '\\`')}\``;

/** Client REST gọn nhẹ cho Typesense 29.0 dùng fetch chuẩn của Node 22. */
export class TypesenseClient {
  private readonly logger = new Logger(TypesenseClient.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(
    config: TypesenseClientConfig,
    private readonly requestFn: typeof fetch = fetch,
  ) {
    this.baseUrl = `${config.protocol}://${config.host}:${config.port}`;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async health(timeoutMs = 2_000): Promise<boolean> {
    try {
      const res = await this.requestFn(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: { 'X-TYPESENSE-API-KEY': this.apiKey },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { ok?: unknown };
      return body.ok === true;
    } catch {
      return false;
    }
  }

  async createCollection(schema: TypesenseCollectionSchema): Promise<void> {
    await this.request('/collections', {
      method: 'POST',
      body: JSON.stringify(schema),
      timeoutMs: BULK_TIMEOUT_MS,
    });
  }

  async deleteCollection(name: string): Promise<void> {
    try {
      await this.request(`/collections/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        timeoutMs: BULK_TIMEOUT_MS,
      });
    } catch (err) {
      if (err instanceof TypesenseError && err.status === 404) return;
      throw err;
    }
  }

  async listCollections(): Promise<Array<{ name: string; num_documents: number }>> {
    return this.request<Array<{ name: string; num_documents: number }>>('/collections', { method: 'GET' });
  }

  async getAlias(alias: string): Promise<{ name: string; collection_name: string } | null> {
    try {
      return await this.request<{ name: string; collection_name: string }>(`/aliases/${encodeURIComponent(alias)}`, {
        method: 'GET',
      });
    } catch (err) {
      if (err instanceof TypesenseError && err.status === 404) return null;
      throw err;
    }
  }

  async upsertAlias(alias: string, collectionName: string): Promise<void> {
    await this.request(`/aliases/${encodeURIComponent(alias)}`, {
      method: 'PUT',
      body: JSON.stringify({ collection_name: collectionName }),
      timeoutMs: BULK_TIMEOUT_MS,
    });
  }

  async upsertSynonym(collection: string, id: string, payload: TypesenseSynonymPayload): Promise<void> {
    await this.request(`/collections/${encodeURIComponent(collection)}/synonyms/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
      timeoutMs: BULK_TIMEOUT_MS,
    });
  }

  async importDocuments(
    collection: string,
    docs: readonly Record<string, unknown>[],
    action: 'create' | 'upsert' | 'update' = 'upsert',
  ): Promise<{ success: number; failed: number }> {
    if (!docs.length) return { success: 0, failed: 0 };
    let success = 0;
    let failed = 0;
    for (let i = 0; i < docs.length; i += IMPORT_CHUNK) {
      const chunk = docs.slice(i, i + IMPORT_CHUNK);
      const ndjson = chunk.map((d) => JSON.stringify(d)).join('\n');
      const raw = await this.requestText(
        `/collections/${encodeURIComponent(collection)}/documents/import?action=${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: ndjson,
          timeoutMs: BULK_TIMEOUT_MS,
        },
      );
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parsed = JSON.parse(trimmed) as { success?: boolean; error?: string };
        if (parsed.success) {
          success += 1;
        } else {
          failed += 1;
          this.logger.warn(`Typesense import dòng lỗi (${collection}): ${parsed.error ?? 'unknown'}`);
        }
      }
    }
    return { success, failed };
  }

  async upsertDocument(collection: string, doc: Record<string, unknown>): Promise<void> {
    await this.request(`/collections/${encodeURIComponent(collection)}/documents?action=upsert`, {
      method: 'POST',
      body: JSON.stringify(doc),
    });
  }

  async deleteDocumentsByIds(collection: string, ids: readonly string[]): Promise<number> {
    if (!ids.length) return 0;
    let total = 0;
    for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
      const chunk = ids.slice(i, i + DELETE_CHUNK);
      const filterBy = `id:=[${chunk.map(escapeTypesenseFilterValue).join(',')}]`;
      try {
        const res = await this.request<{ num_deleted?: number }>(
          `/collections/${encodeURIComponent(collection)}/documents?filter_by=${encodeURIComponent(filterBy)}`,
          { method: 'DELETE' },
        );
        total += res.num_deleted ?? 0;
      } catch (err) {
        if (err instanceof TypesenseError && err.status === 404) return total;
        throw err;
      }
    }
    return total;
  }

  async multiSearch<T>(
    searches: readonly TypesenseSearchRequest[],
    commonParams?: Record<string, string | number | boolean>,
  ): Promise<Array<TypesenseSearchResult<T>>> {
    if (!searches.length) return [];
    const qs = commonParams
      ? `?${new URLSearchParams(Object.entries(commonParams).map(([k, v]) => [k, String(v)])).toString()}`
      : '';
    if (searches.length <= MULTI_SEARCH_CHUNK) {
      const res = await this.request<{ results: Array<TypesenseSearchResult<T>> }>(`/multi_search${qs}`, {
        method: 'POST',
        body: JSON.stringify({ searches }),
      });
      return res.results;
    }
    const chunks: TypesenseSearchRequest[][] = [];
    for (let i = 0; i < searches.length; i += MULTI_SEARCH_CHUNK) {
      chunks.push(searches.slice(i, i + MULTI_SEARCH_CHUNK));
    }
    const batches = await Promise.all(
      chunks.map((chunk) =>
        this.request<{ results: Array<TypesenseSearchResult<T>> }>(`/multi_search${qs}`, {
          method: 'POST',
          body: JSON.stringify({ searches: chunk }),
        }),
      ),
    );
    return batches.flatMap((b) => b.results);
  }

  private async request<T>(
    path: string,
    init: { method: string; body?: string; headers?: Record<string, string>; timeoutMs?: number },
  ): Promise<T> {
    const text = await this.requestText(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private async requestText(
    path: string,
    init: { method: string; body?: string; headers?: Record<string, string>; timeoutMs?: number },
  ): Promise<string> {
    const res = await this.requestFn(`${this.baseUrl}${path}`, {
      method: init.method,
      body: init.body,
      headers: { 'X-TYPESENSE-API-KEY': this.apiKey, ...init.headers },
      signal: AbortSignal.timeout(init.timeoutMs ?? this.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new TypesenseError(res.status, `Typesense ${init.method} ${path} lỗi ${res.status}`, text);
    }
    return text;
  }
}
