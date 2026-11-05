import { readFileSync } from 'node:fs';
import type { MediaQualityLevel } from '@tripflix/contracts';
import type { Db } from '@tripflix/db';
import { sql } from 'drizzle-orm';
import {
  bookmarks,
  comments,
  mediaAssets,
  posts,
  reactions,
  renditions,
  type ReactionType,
  type TripAttachmentData,
} from '../schema/index.js';

interface ContentSeed {
  mediaAssets: {
    id: string;
    ownerId: string;
    status: 'uploading' | 'processing' | 'ready' | 'failed';
    mimeType: string;
    fileSizeBytes: number;
    sourceKey: string;
    hlsPrefix: string;
    durationSec: number;
    aspect: '9:16' | '16:9' | '1:1';
    levels: MediaQualityLevel[];
  }[];
  posts: {
    id: string;
    authorId: string;
    postType: 'video' | 'vlog';
    title: string;
    body: string;
    hashtags: string[];
    status: 'draft' | 'published' | 'hidden' | 'removed' | 'deleted';
    visibility: 'public' | 'private';
    isVerified: boolean;
    mediaIds: string[];
    coverMediaId: string | null;
    tripAttachment: TripAttachmentData;
    reactionCounts: Record<string, number>;
    reactionTotal: number;
    commentCount: number;
    shareCount: number;
    bookmarkCount: number;
    publishedAt: string;
    createdAt: string;
    updatedAt: string;
  }[];
  comments: {
    id: string;
    postId: string;
    authorId: string;
    parentCommentId: string | null;
    body: string;
    isEdited: boolean;
    createdAt: string;
  }[];
  reactions: {
    id: string;
    postId: string;
    userId: string;
    type: ReactionType;
  }[];
  bookmarks: {
    id: string;
    postId: string;
    userId: string;
  }[];
}

export const CONTENT_SEED_FILE = 'src/modules/content/db/seed/posts-seed.json';

export async function seedContent(
  db: Db,
  file = CONTENT_SEED_FILE,
): Promise<{
  mediaAssets: number;
  posts: number;
  comments: number;
  reactions: number;
  bookmarks: number;
}> {
  const seed = JSON.parse(readFileSync(file, 'utf8')) as ContentSeed;

  await db.transaction(async (tx) => {
    // 1. Seed Media Assets
    for (const media of seed.mediaAssets) {
      await tx
        .insert(mediaAssets)
        .values({
          id: media.id,
          ownerId: media.ownerId,
          status: media.status,
          mimeType: media.mimeType,
          fileSizeBytes: media.fileSizeBytes,
          sourceKey: media.sourceKey,
          hlsPrefix: media.hlsPrefix,
          durationSec: media.durationSec,
          aspect: media.aspect,
        })
        .onConflictDoUpdate({
          target: mediaAssets.id,
          set: {
            status: sql`excluded.status`,
            sourceKey: sql`excluded.source_key`,
            hlsPrefix: sql`excluded.hls_prefix`,
            durationSec: sql`excluded.duration_sec`,
            aspect: sql`excluded.aspect`,
            updatedAt: sql`now()`,
          },
        });
      // MediaFacade chỉ trả video có ít nhất một mức, nên thiếu bảng này thì bài seed không lên feed.
      for (const level of media.levels) {
        await tx
          .insert(renditions)
          .values({ assetId: media.id, level })
          .onConflictDoNothing({ target: [renditions.assetId, renditions.level] });
      }
    }

    // 2. Seed Posts
    for (const post of seed.posts) {
      await tx
        .insert(posts)
        .values({
          id: post.id,
          authorId: post.authorId,
          postType: post.postType,
          title: post.title,
          body: post.body,
          hashtags: post.hashtags,
          status: post.status,
          visibility: post.visibility,
          isVerified: post.isVerified,
          mediaIds: post.mediaIds,
          coverMediaId: post.coverMediaId,
          tripAttachment: post.tripAttachment,
          reactionCounts: post.reactionCounts,
          reactionTotal: post.reactionTotal,
          commentCount: post.commentCount,
          shareCount: post.shareCount,
          bookmarkCount: post.bookmarkCount,
          publishedAt: new Date(post.publishedAt),
          createdAt: new Date(post.createdAt),
          updatedAt: new Date(post.updatedAt),
        })
        .onConflictDoUpdate({
          target: posts.id,
          set: {
            title: sql`excluded.title`,
            body: sql`excluded.body`,
            hashtags: sql`excluded.hashtags`,
            status: sql`excluded.status`,
            visibility: sql`excluded.visibility`,
            isVerified: sql`excluded.is_verified`,
            mediaIds: sql`excluded.media_ids`,
            coverMediaId: sql`excluded.cover_media_id`,
            tripAttachment: sql`excluded.trip_attachment`,
            reactionCounts: sql`excluded.reaction_counts`,
            reactionTotal: sql`excluded.reaction_total`,
            commentCount: sql`excluded.comment_count`,
            shareCount: sql`excluded.share_count`,
            bookmarkCount: sql`excluded.bookmark_count`,
            updatedAt: sql`now()`,
          },
        });
    }

    // 3. Seed Comments
    for (const comment of seed.comments) {
      await tx
        .insert(comments)
        .values({
          id: comment.id,
          postId: comment.postId,
          authorId: comment.authorId,
          parentCommentId: comment.parentCommentId,
          body: comment.body,
          isEdited: comment.isEdited,
          createdAt: new Date(comment.createdAt),
          updatedAt: new Date(comment.createdAt),
        })
        .onConflictDoUpdate({
          target: comments.id,
          set: {
            body: sql`excluded.body`,
            isEdited: sql`excluded.is_edited`,
            updatedAt: sql`now()`,
          },
        });
    }

    // 4. Seed Reactions
    for (const reaction of seed.reactions) {
      await tx
        .insert(reactions)
        .values({
          id: reaction.id,
          postId: reaction.postId,
          userId: reaction.userId,
          type: reaction.type,
        })
        .onConflictDoUpdate({
          target: reactions.id,
          set: {
            type: sql`excluded.type`,
            updatedAt: sql`now()`,
          },
        });
    }

    // 5. Seed Bookmarks
    for (const bookmark of seed.bookmarks) {
      await tx
        .insert(bookmarks)
        .values({
          id: bookmark.id,
          postId: bookmark.postId,
          userId: bookmark.userId,
        })
        .onConflictDoNothing({ target: bookmarks.id });
    }
  });

  return {
    mediaAssets: seed.mediaAssets.length,
    posts: seed.posts.length,
    comments: seed.comments.length,
    reactions: seed.reactions.length,
    bookmarks: seed.bookmarks.length,
  };
}
