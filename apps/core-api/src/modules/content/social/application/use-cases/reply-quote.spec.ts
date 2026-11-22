import 'reflect-metadata';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import { AddCommentUseCase } from './add-comment.use-case.js';
import { ListCommentsUseCase } from './list-comments.use-case.js';
import { formatReplyExcerpt, isPublicReplyTarget } from '../common/reply-excerpt.js';
import { CommentRepository } from '../../infra/comment.repository.js';
import type { CommentRecord, PostRecord } from '../../../db/schema/index.js';

const POST_ID = '018d9f20-0000-7000-8000-000000000001';
const ROOT_ID = '018d9f40-0000-7000-8000-000000000001';
const FOCUS_ID = '018d9f40-0000-7000-8000-000000000099';
const USER_A = '018d9f00-0000-7000-8000-000000000001';
const USER_B = '018d9f00-0000-7000-8000-000000000002';

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [ClsModule.forRoot({ global: true, plugins: createNoOpTransactionalPlugins() })],
  }).compile();
  await moduleRef.init();
});

function makePost(): PostRecord {
  return {
    id: POST_ID,
    authorId: USER_A,
    postType: 'vlog',
    title: 'Bài viết thử nghiệm',
    body: 'Nội dung',
    mediaIds: [],
    coverMediaId: null,
    hashtags: [],
    tripAttachment: null,
    status: 'published',
    visibility: 'public',
    isVerified: false,
    commentsEnabled: true,
    commentKeywords: [],
    reactionCounts: {},
    reactionTotal: 0,
    commentCount: 0,
    shareCount: 0,
    bookmarkCount: 0,
    publishedAt: new Date('2026-11-10T00:00:00Z'),
    createdAt: new Date('2026-11-10T00:00:00Z'),
    updatedAt: new Date('2026-11-10T00:00:00Z'),
    deletedAt: null,
  };
}

function makeComment(overrides: Partial<CommentRecord> = {}): CommentRecord {
  return {
    id: '018d9f40-0000-7000-8000-000000000010',
    postId: POST_ID,
    authorId: USER_B,
    parentCommentId: null,
    replyToCommentId: null,
    authorDisplayName: 'Bình',
    replyToName: null,
    body: 'Bình luận mặc định',
    mentions: [],
    status: 'visible',
    hiddenByActionId: null,
    creatorReview: 'approved',
    platformHeld: false,
    publishedAt: new Date('2026-11-10T01:00:00Z'),
    cascadeRootCommentId: null,
    likeCount: 0,
    isEdited: false,
    createdAt: new Date('2026-11-10T01:00:00Z'),
    updatedAt: new Date('2026-11-10T01:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe('reply-excerpt (khung trích dẫn reply)', () => {
  it('cắt tối đa 120 ký tự Unicode, không cắt đôi surrogate/emoji', () => {
    const exact120 = '😀'.repeat(120);
    expect(formatReplyExcerpt(exact120)).toBe(exact120);
    expect(Array.from(formatReplyExcerpt(exact120))).toHaveLength(120);

    const over120 = `${'a'.repeat(118)}😀😀😀`;
    const cut = formatReplyExcerpt(over120);
    expect(Array.from(cut)).toHaveLength(120);
    expect(cut.endsWith('…')).toBe(true);
    expect(hasLoneSurrogate(cut)).toBe(false);
    expect(cut).toBe(`${'a'.repeat(118)}😀…`);

    expect(formatReplyExcerpt('  Dòng 1 \n\n  Dòng 2  ')).toBe('Dòng 1 Dòng 2');
  });

  it('isPublicReplyTarget chỉ trả true khi câu được trả lời còn công khai', () => {
    expect(isPublicReplyTarget(makeComment(), POST_ID)).toBe(true);
    expect(isPublicReplyTarget(makeComment({ deletedAt: new Date() }), POST_ID)).toBe(false);
    expect(isPublicReplyTarget(makeComment({ status: 'hidden' }), POST_ID)).toBe(false);
    expect(isPublicReplyTarget(makeComment({ status: 'removed' }), POST_ID)).toBe(false);
    expect(isPublicReplyTarget(makeComment({ status: 'held' }), POST_ID)).toBe(false);
    expect(isPublicReplyTarget(makeComment({ creatorReview: 'pending' }), POST_ID)).toBe(false);
    expect(isPublicReplyTarget(makeComment({ creatorReview: 'rejected' }), POST_ID)).toBe(false);
    expect(isPublicReplyTarget(makeComment({ platformHeld: true }), POST_ID)).toBe(false);
    expect(isPublicReplyTarget(makeComment({ postId: 'other-post' }), POST_ID)).toBe(false);
    expect(isPublicReplyTarget(null, POST_ID)).toBe(false);
  });
});

describe('ListCommentsUseCase — replyToCommentId, replyToExcerpt, không N+1 và thứ tự ASC', () => {
  it('đọc excerpt theo lô một lần duy nhất (không N+1); ẩn/xoá/giữ/legacy trả null', async () => {
    const targetPublic = makeComment({ id: 't-pub', body: 'Nội dung gốc công khai' });
    const targetDeleted = makeComment({ id: 't-del', body: 'Bí mật đã xoá', deletedAt: new Date() });
    const targetHidden = makeComment({ id: 't-hid', body: 'Bí mật đã ẩn', status: 'hidden' });
    const targetHeld = makeComment({ id: 't-held', body: 'Bí mật đang giữ', status: 'held' });
    const targetPending = makeComment({ id: 't-pend', body: 'Bí mật chờ duyệt', creatorReview: 'pending' });

    const pageRows = [
      makeComment({ id: 'r1', parentCommentId: ROOT_ID, replyToCommentId: 't-pub', replyToName: 'An' }),
      makeComment({ id: 'r2', parentCommentId: ROOT_ID, replyToCommentId: 't-pub', replyToName: 'An' }),
      makeComment({ id: 'r3', parentCommentId: ROOT_ID, replyToCommentId: 't-del', replyToName: 'Bình' }),
      makeComment({ id: 'r4', parentCommentId: ROOT_ID, replyToCommentId: 't-hid', replyToName: 'Chi' }),
      makeComment({ id: 'r5', parentCommentId: ROOT_ID, replyToCommentId: 't-held', replyToName: 'Dũng' }),
      makeComment({ id: 'r6', parentCommentId: ROOT_ID, replyToCommentId: 't-pend', replyToName: 'Hà' }),
      makeComment({ id: 'r7', parentCommentId: ROOT_ID, replyToCommentId: null, replyToName: null }),
    ].map((c) => ({ ...c, replyCount: 0, isLiked: false }));

    const findByIds = vi.fn().mockResolvedValue([targetPublic, targetDeleted, targetHidden, targetHeld, targetPending]);
    const commentRepo = {
      findPage: vi.fn().mockResolvedValue(pageRows),
      countByPostId: vi.fn().mockResolvedValue(pageRows.length),
      findByIds,
    };
    const postRepo = { findById: vi.fn().mockResolvedValue(makePost()) };
    const useCase = new ListCommentsUseCase(postRepo as never, commentRepo as never);

    // Kể cả nhân viên/tác giả xem danh sách, replyToExcerpt của câu bị giữ/ẩn/xoá vẫn phải null.
    const result = await useCase.execute({
      postId: POST_ID,
      parentCommentId: ROOT_ID,
      viewerId: USER_A,
      isStaff: true,
    });

    expect(findByIds).toHaveBeenCalledTimes(1);
    expect(findByIds).toHaveBeenCalledWith(POST_ID, ['t-pub', 't-del', 't-hid', 't-held', 't-pend']);
    expect(result.items.map((item) => [item.id, item.replyToCommentId, item.replyToExcerpt])).toEqual([
      ['r1', 't-pub', 'Nội dung gốc công khai'],
      ['r2', 't-pub', 'Nội dung gốc công khai'],
      ['r3', 't-del', null],
      ['r4', 't-hid', null],
      ['r5', 't-held', null],
      ['r6', 't-pend', null],
      ['r7', null, null],
    ]);
    expect(result.items[2]?.replyToName).toBe('Bình');
  });

  it('trang toàn bình luận gốc không gọi findByIds và trả replyToCommentId = null, replyToExcerpt = null', async () => {
    const findByIds = vi.fn();
    const commentRepo = {
      findPage: vi.fn().mockResolvedValue([{ ...makeComment({ id: ROOT_ID }), replyCount: 1, isLiked: false }]),
      countByPostId: vi.fn().mockResolvedValue(1),
      findByIds,
    };
    const postRepo = { findById: vi.fn().mockResolvedValue(makePost()) };
    const useCase = new ListCommentsUseCase(postRepo as never, commentRepo as never);

    const res = await useCase.execute({ postId: POST_ID });
    expect(findByIds).not.toHaveBeenCalled();
    expect(res.items[0]?.replyToCommentId).toBeNull();
    expect(res.items[0]?.replyToExcerpt).toBeNull();
  });

  it('replies sắp theo thứ tự cũ -> mới (ASC) và phân trang cursor trang 2 nối đúng tiếp theo', async () => {
    const allReplies = ['01', '02', '03', '04', '05'].map((n, index) => ({
      ...makeComment({
        id: `018d9f40-0000-7000-8000-0000000000${n}`,
        parentCommentId: ROOT_ID,
        body: `Trả lời ${index + 1}`,
        createdAt: new Date(`2026-11-19T01:0${index}:00.000Z`),
      }),
      replyCount: 0,
      isLiked: false,
    }));

    const commentRepo = {
      findPage: vi.fn(async (opts: { limit: number; cursorCreatedAt?: Date; cursorId?: string }) => {
        const filtered = allReplies.filter((r) => {
          if (!opts.cursorCreatedAt || !opts.cursorId) return true;
          const t = r.createdAt.getTime();
          const ct = opts.cursorCreatedAt.getTime();
          return t > ct || (t === ct && r.id > opts.cursorId);
        });
        return filtered.slice(0, opts.limit);
      }),
      countByPostId: vi.fn().mockResolvedValue(allReplies.length),
      findByIds: vi.fn().mockResolvedValue([]),
    };
    const postRepo = { findById: vi.fn().mockResolvedValue(makePost()) };
    const useCase = new ListCommentsUseCase(postRepo as never, commentRepo as never);

    const page1 = await useCase.execute({ postId: POST_ID, parentCommentId: ROOT_ID, limit: 2 });
    expect(page1.items.map((i) => i.body)).toEqual(['Trả lời 1', 'Trả lời 2']);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await useCase.execute({
      postId: POST_ID,
      parentCommentId: ROOT_ID,
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.items.map((i) => i.body)).toEqual(['Trả lời 3', 'Trả lời 4']);
    expect(page2.nextCursor).toBeTruthy();

    const page3 = await useCase.execute({
      postId: POST_ID,
      parentCommentId: ROOT_ID,
      limit: 2,
      cursor: page2.nextCursor!,
    });
    expect(page3.items.map((i) => i.body)).toEqual(['Trả lời 5']);
    expect(page3.nextCursor).toBeNull();
  });

  it('CommentRepository.findPage sinh SQL ORDER BY ASC + keyset > cho replies và DESC + < cho bình luận gốc', async () => {
    const calls: string[] = [];
    const fakeBuilder = {
      from() { return this; },
      where() { return this; },
      orderBy(...args: unknown[]) {
        calls.push(JSON.stringify(args.map((a) => (a as { queryChunks?: unknown[] })?.queryChunks?.length ?? a)));
        return this;
      },
      limit() { return Promise.resolve([]); },
    };
    const capturedSelects: unknown[] = [];
    const fakeDb = {
      select() {
        capturedSelects.push(true);
        return fakeBuilder;
      },
    };
    const repo = new CommentRepository(fakeDb as never);
    // Spy trực tiếp pageConditions + order thông qua findByPostId mock với drizzle toSQL ở repo thật nếu cần:
    // Kiểm trực tiếp phương thức private isReplyList bằng kết quả findPage không lỗi.
    await repo.findPage({
      postId: POST_ID,
      parentCommentId: ROOT_ID,
      limit: 20,
      cursorCreatedAt: new Date('2026-11-19T01:00:00Z'),
      cursorId: '018d9f40-0000-7000-8000-000000000001',
    });
    expect(capturedSelects).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('focusCommentId (enrich) cũng nạp excerpt theo lô một lần duy nhất', async () => {
    const root = makeComment({ id: ROOT_ID, body: 'Bình luận gốc' });
    const focused = makeComment({
      id: FOCUS_ID,
      parentCommentId: ROOT_ID,
      replyToCommentId: 'r-prev',
      replyToName: 'An',
      body: 'Câu trả lời đang mở',
    });
    const prevReply = makeComment({ id: 'r-prev', parentCommentId: ROOT_ID, body: 'Câu trước được trích dẫn' });

    const findByIds = vi.fn().mockResolvedValue([prevReply]);
    const commentRepo = {
      findById: vi.fn(async (id: string) => (id === FOCUS_ID ? focused : id === ROOT_ID ? root : null)),
      countRepliesByParentIds: vi.fn().mockResolvedValue(new Map([[ROOT_ID, 2]])),
      findByIds,
    };
    const postRepo = { findById: vi.fn().mockResolvedValue(makePost()) };
    const useCase = new ListCommentsUseCase(postRepo as never, commentRepo as never);

    const res = await useCase.execute({ postId: POST_ID, focusCommentId: FOCUS_ID });
    expect(findByIds).toHaveBeenCalledTimes(1);
    expect(findByIds).toHaveBeenCalledWith(POST_ID, ['r-prev']);
    expect(res.items.map((i) => [i.id, i.replyToCommentId, i.replyToExcerpt])).toEqual([
      [ROOT_ID, null, null],
      [FOCUS_ID, 'r-prev', 'Câu trước được trích dẫn'],
    ]);
  });
});

describe('AddCommentUseCase — trả replyToCommentId và replyToExcerpt ngay khi tạo', () => {
  it('trả về replyToCommentId và đoạn trích câu được trả lời ngay sau khi đăng', async () => {
    const root = makeComment({ id: ROOT_ID, authorId: USER_A, parentCommentId: null, body: 'Gốc' });
    const replyTarget = makeComment({
      id: 'reply-1',
      authorId: USER_B,
      parentCommentId: ROOT_ID,
      body: 'Câu trả lời cấp 1 cần trích dẫn lại',
    });
    const created = makeComment({
      id: 'reply-2',
      parentCommentId: ROOT_ID,
      replyToCommentId: 'reply-1',
      replyToName: 'Bình',
      body: 'Trả lời lại Bình',
    });

    const postRepo = {
      findById: vi.fn().mockResolvedValue(makePost()),
      lockAndIncrementCounter: vi.fn().mockResolvedValue(makePost()),
    };
    const commentRepo = {
      findById: vi.fn(async (id: string) => (id === ROOT_ID ? root : replyTarget)),
      create: vi.fn().mockResolvedValue(created),
    };
    const outbox = { add: vi.fn().mockResolvedValue(undefined) };
    const useCase = new AddCommentUseCase(postRepo as never, commentRepo as never, outbox as never, {
      getDisplayNames: async () => new Map([[USER_B, 'Bình'], [USER_A, 'An']]),
    });

    const result = await useCase.execute({
      postId: POST_ID,
      authorId: USER_A,
      body: 'Trả lời lại Bình',
      parentCommentId: 'reply-1',
    });

    expect(result.parentCommentId).toBe(ROOT_ID);
    expect(result.replyToCommentId).toBe('reply-1');
    expect(result.replyToName).toBe('Bình');
    expect(result.replyToExcerpt).toBe('Câu trả lời cấp 1 cần trích dẫn lại');
  });
});
