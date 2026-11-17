import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toRawRows } from '../../modules/discovery/recommend/domain/ingest/to-raw-rows.js';
import { contentStateOf, loadSimDataset, simId, uuidV5 } from './convert.js';

const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join('\n');
const ev = (eventId: string, type: string, occurredAt: string, payload: Record<string, unknown>, stream = 'stream:core.content') => ({
  eventId,
  type,
  version: 1,
  occurredAt,
  stream,
  payload,
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-recommend-'));
  writeFileSync(join(dir, 'split.json'), JSON.stringify({ totalDays: 2 }));
  writeFileSync(join(dir, 'places.json'), JSON.stringify([{ id: 'da-lat', name: 'Đà Lạt' }]));
  writeFileSync(
    join(dir, 'users_truth.jsonl'),
    jsonl([
      { id: 'usr_00001', signupDay: 0, following: ['usr_00002'], hasGuestMerged: false, dreamPlaces: ['da-lat'] },
      { id: 'usr_00002', signupDay: 0, following: [], hasGuestMerged: false },
    ]),
  );
  const post = (id: string, postType: string, placeId: string | null) => ({
    id,
    authorId: 'usr_00002',
    postType,
    title: `Bài ${id}`,
    body: '',
    hashtags: ['dalat'],
    status: 'published',
    visibility: 'public',
    isVerified: false,
    coverMediaId: null,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    placeId,
  });
  writeFileSync(join(dir, 'posts.jsonl'), jsonl([post('post_000001', 'video', 'da-lat'), post('post_000002', 'vlog', null), post('post_000003', 'video', null)]));
  writeFileSync(
    join(dir, 'events.jsonl'),
    jsonl([
      ev('11111111-1111-4111-8111-111111111111', 'content.reaction.updated', '2026-07-14T08:00:00Z', { postId: 'post_000001', userId: 'usr_00001', type: 'like' }),
      // Giao lại cùng eventId.
      ev('11111111-1111-4111-8111-111111111111', 'content.reaction.updated', '2026-07-14T08:00:00Z', { postId: 'post_000001', userId: 'usr_00001', type: 'like' }),
      ev('22222222-2222-4222-8222-222222222222', 'content.reaction.updated', '2026-07-14T09:00:00Z', { postId: 'post_000002', userId: 'usr_00001', type: 'love' }),
      ev('33333333-3333-4333-8333-333333333333', 'content.reaction.updated', '2026-07-14T10:00:00Z', { postId: 'post_000002', userId: 'usr_00001', type: null }),
      ev('44444444-4444-4444-8444-444444444444', 'content.bookmark.updated', '2026-07-14T10:00:00Z', { postId: 'post_000001', userId: 'usr_00001', isBookmarked: true }),
      ev('55555555-5555-4555-8555-555555555555', 'content.comment_reaction.updated', '2026-07-14T11:00:00Z', {
        commentId: 'cmt_1',
        postId: 'post_000001',
        userId: 'usr_00001',
        type: 'like',
      }),
      ev(
        '66666666-6666-4666-8666-666666666666',
        'discovery.search.performed',
        '2026-07-15T11:00:00Z',
        { userId: 'usr_00001', placeId: 'da-lat', intent: 'see', budgetMax: 3992000.4, dateFrom: null, dateTo: null, guests: 2 },
        'stream:core.discovery',
      ),
      ev(
        '77777777-7777-4777-8777-777777777777',
        'discovery.stays.searched',
        '2026-07-15T12:00:00Z',
        { userId: 'usr_00001', placeId: 'da-lat', intent: 'book', budgetMax: null, dateFrom: '2026-08-01', dateTo: '2026-08-03', guests: 2 },
        'stream:core.discovery',
      ),
      ev('88888888-8888-4888-8888-888888888888', 'content.post.published', '2026-07-15T13:00:00Z', { postId: 'post_000003', authorId: 'usr_00002' }),
      ev('99999999-9999-4999-8999-999999999999', 'content.post.deleted', '2026-07-15T14:00:00Z', { postId: 'post_000003', authorId: 'usr_00002' }),
    ]),
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('uuidV5', () => {
  it('khớp vector chuẩn RFC 4122 (namespace DNS, "www.example.com")', () => {
    expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });
  it('cùng id mô phỏng ra cùng uuid, khác loại thì khác uuid', () => {
    expect(simId.user('usr_00001')).toBe(simId.user('usr_00001'));
    expect(simId.user('x')).not.toBe(simId.post('x'));
  });
});

describe('loadSimDataset', () => {
  it('dời mọi mốc thời gian đúng số ngày', () => {
    const ds = loadSimDataset(dir, 7);
    expect(ds.events[0]!.envelope.occurredAt).toBe('2026-07-21T08:00:00.000Z');
    expect(ds.posts[0]!.createdAt.toISOString()).toBe('2026-07-08T00:00:00.000Z');
    expect(ds.simEnd.toISOString()).toBe('2026-07-22T23:59:59.000Z');
  });

  it('bỏ loại hệ thống không phát, giữ bản giao lại để thử idempotent', () => {
    const ds = loadSimDataset(dir, 0);
    expect(ds.events.some((e) => e.envelope.type === 'content.bookmark.updated')).toBe(false);
    expect(ds.skipped).toContainEqual(expect.objectContaining({ type: 'content.bookmark.updated', count: 1 }));
    expect(ds.duplicateEventIds).toBe(1);
    expect(ds.events.filter((e) => e.simEventId === '11111111-1111-4111-8111-111111111111')).toHaveLength(2);
  });

  it('payload sau khi chuyển qua được toRawRows thật', () => {
    const ds = loadSimDataset(dir, 0);
    // Sự kiện đầu tiên của mỗi loại.
    const byType = new Map([...ds.events].reverse().map((e) => [e.envelope.type, e]));
    const reaction = toRawRows(byType.get('content.reaction.updated')!.envelope);
    expect(reaction).toEqual([expect.objectContaining({ kind: 'reaction', actorId: simId.user('usr_00001'), targetId: simId.post('post_000001') })]);
    expect(toRawRows(byType.get('content.comment_reaction.updated')!.envelope)).toEqual([
      expect.objectContaining({ kind: 'comment_reaction', isRemoved: false }),
    ]);
    expect(toRawRows(byType.get('discovery.search.performed')!.envelope)).toEqual([
      expect.objectContaining({ kind: 'search', targetId: 'da-lat', detail: expect.objectContaining({ budgetMax: 3992000 }) }),
    ]);
    expect(toRawRows(byType.get('discovery.stays.searched')!.envelope)).toEqual([
      expect.objectContaining({ kind: 'stays_search', detail: expect.objectContaining({ checkIn: '2026-08-01', checkOut: '2026-08-03', adults: 2 }) }),
    ]);
    expect(toRawRows(byType.get('content.post.published')!.envelope)).toEqual([
      expect.objectContaining({ kind: 'publish', detail: { postType: 'video' } }),
    ]);
  });

  it('gán chỉ số video liên tiếp chỉ cho bài video, ghi tên nơi để hệ thống tự suy placeId', () => {
    const ds = loadSimDataset(dir, 0);
    expect(ds.posts.map((p) => p.videoIndex)).toEqual([0, null, 1]);
    expect(ds.posts[0]!.destination).toEqual({ placeId: 'da-lat', name: 'Đà Lạt' });
  });

  it('chỉ lấy id và danh sách theo dõi từ users_truth, không mang gu', () => {
    const ds = loadSimDataset(dir, 0);
    expect(ds.follows).toEqual([expect.objectContaining({ followerId: simId.user('usr_00001'), authorId: simId.user('usr_00002') })]);
    expect(Object.keys(ds.users[0]!).sort()).toEqual(['createdAt', 'displayName', 'email', 'id', 'simId']);
    expect(ds.users[0]!.email).toBe('usr_00001@sim.tripflix.local');
  });
});

describe('contentStateOf', () => {
  it('lấy trạng thái cuối: cảm xúc đã gỡ thì không còn, bài xoá có trạng thái deleted', () => {
    const state = contentStateOf(dir, 0);
    expect(state.reactions).toEqual([expect.objectContaining({ postId: simId.post('post_000001'), type: 'like' })]);
    expect(state.bookmarks).toHaveLength(1);
    expect(state.postStatus.get(simId.post('post_000003'))?.status).toBe('deleted');
  });
});
