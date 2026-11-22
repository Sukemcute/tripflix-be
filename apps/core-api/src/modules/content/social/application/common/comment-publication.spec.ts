import type { Db } from '@tripflix/db';
import { commentPublicationPayload, loadCommentPublicationContext } from './comment-publication.js';

const post = { id: 'post', authorId: 'owner', visibility: 'public' as const };
const comment = { id: 'comment', authorId: 'writer', body: 'reply', parentCommentId: 'root' };

describe('comment publication recipient', () => {
  it('TF25: publishes unique mentioned user IDs for immediate and delayed publication', async () => {
    const mentions = [{ userId: 'tagged', offset: 0, length: 3 }];
    const context = { parentCommentAuthorId: null, replyToAuthorId: null };
    expect(commentPublicationPayload({ ...comment, mentions }, post, context).mentionedUserIds).toEqual(['tagged']);
    // Platform release passes a projection without mentions; the shared loader reads the stored tags.
    const db = { select: () => ({ from: () => ({ where: async () => [{ ...comment, mentions }] }) }) } as unknown as Db;
    const delayedContext = await loadCommentPublicationContext(db, post.id, comment);
    expect(commentPublicationPayload(comment, post, delayedContext).mentionedUserIds).toEqual(['tagged']);
    expect(commentPublicationPayload({ ...comment, mentions: [] }, post, delayedContext)).not.toHaveProperty('mentionedUserIds');
  });

  it('does not infer a legacy reply recipient from the root author', () => {
    const payload = commentPublicationPayload(comment, post, {
      parentCommentAuthorId: 'A',
      replyToAuthorId: null,
    });
    expect(payload.replyRecipientKnown).toBe(false);
    expect(payload).not.toHaveProperty('replyToAuthorId');
    expect(payload).not.toHaveProperty('replyToCommentId');
  });

  it('preserves the exact reply target and trusted author snapshot', () => {
    expect(
      commentPublicationPayload(
        { ...comment, replyToCommentId: 'target', authorDisplayName: 'C' },
        post,
        { parentCommentAuthorId: 'A', replyToAuthorId: 'B' },
        '2026-11-18T00:00:00.000Z',
      ),
    ).toMatchObject({
      replyRecipientKnown: true,
      replyToCommentId: 'target',
      replyToAuthorId: 'B',
      parentCommentAuthorId: 'A',
      authorDisplayName: 'C',
      postVisibility: 'public',
      createdAt: '2026-11-18T00:00:00.000Z',
    });
  });
});
