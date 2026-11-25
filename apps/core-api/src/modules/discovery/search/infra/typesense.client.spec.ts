import { TypesenseClient, TypesenseError, escapeTypesenseFilterValue } from './typesense.client.js';

const clientOf = (fetchImpl: typeof fetch) =>
  new TypesenseClient({ host: 'localhost', port: 8108, protocol: 'http', apiKey: 'test-key' }, fetchImpl);

describe('TypesenseClient', () => {
  it('escapeTypesenseFilterValue bọc backtick và escape backtick bên trong', () => {
    expect(escapeTypesenseFilterValue('Đà Lạt')).toBe('`Đà Lạt`');
    expect(escapeTypesenseFilterValue('a`b')).toBe('`a\\`b`');
  });

  it('health: trả true khi /health ok, false khi lỗi mạng hoặc HTTP non-200', async () => {
    const okFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    expect(await clientOf(okFetch as unknown as typeof fetch).health()).toBe(true);

    const errFetch = vi.fn(async () => new Response('down', { status: 503 }));
    expect(await clientOf(errFetch as unknown as typeof fetch).health()).toBe(false);

    const throwFetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(await clientOf(throwFetch as unknown as typeof fetch).health()).toBe(false);
  });

  it('getAlias / deleteCollection / deleteDocumentsByIds bỏ qua 404 nhẹ nhàng', async () => {
    const fetch404 = vi.fn(async () => new Response('not found', { status: 404 }));
    const c = clientOf(fetch404 as unknown as typeof fetch);
    expect(await c.getAlias('explore')).toBeNull();
    await expect(c.deleteCollection('explore_old')).resolves.toBeUndefined();
    expect(await c.deleteDocumentsByIds('explore', ['post:1'])).toBe(0);
  });

  it('importDocuments: gửi NDJSON với action đúng và đếm số thành công / thất bại', async () => {
    const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const resolvedUrl = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      calls.push({
        url: resolvedUrl,
        body: bodyText,
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return new Response('{"success":true}\n{"success":false,"error":"bad doc"}\n', { status: 200 });
    });

    const c = clientOf(fetchMock as unknown as typeof fetch);
    const res = await c.importDocuments('explore_1', [{ id: '1' }, { id: '2' }], 'create');
    expect(res).toEqual({ success: 1, failed: 1 });
    expect(calls[0]!.url).toBe('http://localhost:8108/collections/explore_1/documents/import?action=create');
    expect(calls[0]!.headers['X-TYPESENSE-API-KEY']).toBe('test-key');
    expect(calls[0]!.headers['Content-Type']).toBe('text/plain');
    expect(calls[0]!.body).toBe('{"id":"1"}\n{"id":"2"}');
  });

  it('multiSearch: gửi 1 request khi <= 40 searches và tự chia lô khi > 40 searches', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '{}';
      const payload = JSON.parse(bodyText) as { searches: unknown[] };
      return new Response(
        JSON.stringify({ results: payload.searches.map((_, idx) => ({ found: idx + 1, hits: [] })) }),
        { status: 200 },
      );
    });

    const c = clientOf(fetchMock as unknown as typeof fetch);
    const small = await c.multiSearch([{ q: 'pho' }, { q: 'cafe' }], { collection: 'explore' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(small).toHaveLength(2);

    fetchMock.mockClear();
    const bigSearches = Array.from({ length: 45 }, (_, i) => ({ q: `q${i}` }));
    const big = await c.multiSearch(bigSearches, { collection: 'explore' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(big).toHaveLength(45);
  });

  it('ném TypesenseError kèm status khi lỗi non-404', async () => {
    const fetchErr = vi.fn(async () => new Response('bad schema', { status: 400 }));
    const c = clientOf(fetchErr as unknown as typeof fetch);
    await expect(c.createCollection({ name: 'bad', fields: [] })).rejects.toBeInstanceOf(TypesenseError);
  });
});
