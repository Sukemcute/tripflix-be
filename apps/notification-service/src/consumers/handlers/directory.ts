import {
  AccessUserProfileUpdatedV1Schema,
  AccessUserRegisteredV1Schema,
} from '@tripflix/contracts';
import { z } from 'zod';
import type { DirectoryRepository } from '../../directory/directory.repository.js';
import type { FollowerPostWorker } from '../../inbox/follower-post.worker.js';
import type { EventHandler } from './event-handler.js';

const PostPublishedSchema = z.object({
  postId: z.uuid(),
  authorId: z.uuid(),
  title: z.string(),
  publishedAt: z.iso.datetime(),
});
const PostDeletedSchema = z.object({ postId: z.uuid(), authorId: z.uuid(), deletedAt: z.iso.datetime() });

export function createDirectoryHandlers(
  directory: Pick<DirectoryRepository, 'upsertUser' | 'upsertPost'>,
  followerPosts?: Pick<FollowerPostWorker, 'enqueue' | 'cancel' | 'applyFollow'>,
): Record<string, EventHandler> {
  return {
    'access.user.registered.v1': async (event) => {
      await directory.upsertUser(AccessUserRegisteredV1Schema.parse(event.payload), event.occurredAt);
      return true;
    },
    'access.user.profile_updated.v1': async (event) => {
      await directory.upsertUser(AccessUserProfileUpdatedV1Schema.parse(event.payload), event.occurredAt);
      return true;
    },
    'content.follow.changed.v1': async (event) => {
      if (!followerPosts) return false;
      const change = z.object({ followerId: z.uuid(), authorId: z.uuid(), followedAt: z.iso.datetime().nullable() }).parse(event.payload);
      await followerPosts.applyFollow({ ...change, changedAt: event.occurredAt });
      return true;
    },
    'content.post.published.v1': async (event) => {
      const { postId, authorId, title, publishedAt } = PostPublishedSchema.parse(event.payload);
      await directory.upsertPost({ postId, authorId, title, deletedAt: null, updatedAt: publishedAt });
      await followerPosts?.enqueue(postId, authorId);
      return true;
    },
    'content.post.updated.v1': async (event) => {
      if (!followerPosts) return false;
      const { postId, authorId, visibility } = z.object({
        postId: z.uuid(), authorId: z.uuid(), visibility: z.string(),
      }).parse(event.payload);
      if (visibility !== 'public') await followerPosts.cancel(postId, authorId);
      return true;
    },
    'content.post.deleted.v1': async (event) => {
      const { postId, authorId, deletedAt } = PostDeletedSchema.parse(event.payload);
      await directory.upsertPost({ postId, authorId, title: null, deletedAt, updatedAt: deletedAt });
      await followerPosts?.cancel(postId, authorId);
      return true;
    },
  };
}
