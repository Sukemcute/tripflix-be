import {
  ContentCommentCreatedV1Schema,
  ContentCommentDeletedV1Schema,
  ContentCommentHiddenV1Schema,
  ContentCommentRestoredV1Schema,
  ContentCommentUpdatedV1Schema,
  type EventEnvelope,
  type PostVisibility,
} from '@tripflix/contracts';

/** Tín hiệu "bình luận của bài vừa đổi": web tải lại danh sách, không có nội dung bình luận. */
export const POST_COMMENTS_CHANGED_EVENT = 'post.comments.changed';
/** Bài nhận hơn ~4 thay đổi/giây thì gom, mỗi bài tối đa một tín hiệu mỗi khoảng này. */
export const POST_SIGNAL_WINDOW_MS = 250;

export type PostCommentChangeKind = 'created' | 'updated' | 'deleted' | 'hidden' | 'restored';

export interface PostCommentChange {
  postId: string;
  commentId: string;
  parentCommentId: string | null;
  kind: PostCommentChangeKind;
  actorId: string | null;
}

interface ParsedChange extends PostCommentChange {
  postVisibility?: PostVisibility;
}

const PARSERS: Record<string, (payload: unknown) => ParsedChange> = {
  'content.comment.created.v1': (payload) => {
    const p = ContentCommentCreatedV1Schema.parse(payload);
    return { ...pick(p), kind: 'created', actorId: p.authorId };
  },
  'content.comment.updated.v1': (payload) => {
    const p = ContentCommentUpdatedV1Schema.parse(payload);
    return { ...pick(p), kind: 'updated', actorId: p.authorId };
  },
  'content.comment.deleted.v1': (payload) => {
    const p = ContentCommentDeletedV1Schema.parse(payload);
    return { ...pick(p), kind: 'deleted', actorId: p.deletedBy };
  },
  // Ẩn/hiện lại do kiểm duyệt: không gửi người làm để không lộ kiểm duyệt viên.
  'content.comment.hidden.v1': (payload) => {
    const p = ContentCommentHiddenV1Schema.parse(payload);
    return { ...pick({ ...p, parentCommentId: null }), kind: 'hidden', actorId: null };
  },
  'content.comment.restored.v1': (payload) => {
    const p = ContentCommentRestoredV1Schema.parse(payload);
    return { ...pick({ ...p, parentCommentId: p.parentCommentId ?? null }), kind: 'restored', actorId: null };
  },
};

function pick(p: { postId: string; commentId: string; parentCommentId: string | null; postVisibility?: PostVisibility }) {
  return { postId: p.postId, commentId: p.commentId, parentCommentId: p.parentCommentId, postVisibility: p.postVisibility };
}

/** Chỉ bài public mới có tín hiệu; sự kiện cũ thiếu postVisibility thì không phát. */
export function toPostCommentChange(event: EventEnvelope): PostCommentChange | null {
  const parse = PARSERS[`${event.type}.v${event.version}`];
  if (!parse) return null;
  const { postVisibility, ...change } = parse(event.payload);
  return postVisibility === 'public' ? change : null;
}

interface PostWindow {
  pending?: PostCommentChange;
  pendingCount: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Phát tín hiệu vào phòng post:<postId>. Thay đổi đầu tiên phát ngay; thay đổi tới trong 250 ms sau đó
 * được gom, cuối khoảng phát một lần với thay đổi mới nhất và changeCount. Gom theo từng replica.
 */
export class PostCommentSignals {
  private readonly windows = new Map<string, PostWindow>();

  constructor(
    private readonly emit: (postId: string, data: PostCommentChange & { changeCount: number }) => void,
    private readonly onError: (error: unknown, event: EventEnvelope) => void,
  ) {}

  /** Không bao giờ ném lỗi: tín hiệu hỏng không được làm hỏng thông báo. */
  handle(event: EventEnvelope): void {
    try {
      const change = toPostCommentChange(event);
      if (!change) return;
      const window = this.windows.get(change.postId);
      if (window) {
        window.pending = change;
        window.pendingCount += 1;
        return;
      }
      this.send(change, 1);
      this.openWindow(change.postId);
    } catch (error) {
      this.onError(error, event);
    }
  }

  stop(): void {
    for (const window of this.windows.values()) clearTimeout(window.timer);
    this.windows.clear();
  }

  private openWindow(postId: string): void {
    const window: PostWindow = { pendingCount: 0, timer: setTimeout(() => this.flush(postId), POST_SIGNAL_WINDOW_MS) };
    window.timer.unref?.();
    this.windows.set(postId, window);
  }

  private flush(postId: string): void {
    const window = this.windows.get(postId);
    this.windows.delete(postId);
    if (!window?.pending) return;
    this.send(window.pending, window.pendingCount);
    // Bài còn nóng: mở khoảng mới để nhịp phát giữ tối đa một lần mỗi 250 ms.
    this.openWindow(postId);
  }

  private send(change: PostCommentChange, changeCount: number): void {
    try {
      this.emit(change.postId, { ...change, changeCount });
    } catch {
      // Phát lỗi chỉ mất một tín hiệu; web vẫn đúng khi tải lại.
    }
  }
}
