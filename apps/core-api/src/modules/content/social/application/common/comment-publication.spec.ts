import { commentPublicationPayload } from './comment-publication.js';

const post = { id: 'post', authorId: 'owner', visibility: 'public' as const };
const comment = { id: 'comment', authorId: 'writer', body: 'reply', parentCommentId: 'root' };

describe('comment publication recipient', () => {
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
