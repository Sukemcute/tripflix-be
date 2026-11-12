import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { DB } from '../tokens.js';

@Injectable()
export class DirectoryRepository {
  constructor(@Inject(DB) private readonly pool: pg.Pool) {}

  async upsertUser(user: { userId: string; displayName: string }, updatedAt: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_directory (user_id, display_name, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE
       SET display_name = EXCLUDED.display_name, updated_at = EXCLUDED.updated_at
       WHERE user_directory.updated_at < EXCLUDED.updated_at`,
      [user.userId, user.displayName, updatedAt],
    );
  }

  async upsertPost(post: {
    postId: string;
    authorId: string;
    title: string | null;
    deletedAt: string | null;
    updatedAt: string;
  }): Promise<void> {
    // Giữ dấu xóa cả khi sự kiện đăng bài chưa tới hoặc được giao lại.
    await this.pool.query(
      `INSERT INTO post_directory (post_id, author_id, title, deleted_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (post_id) DO UPDATE
       SET author_id = EXCLUDED.author_id, title = COALESCE(EXCLUDED.title, post_directory.title),
           deleted_at = EXCLUDED.deleted_at, updated_at = EXCLUDED.updated_at
       WHERE post_directory.updated_at < EXCLUDED.updated_at
          OR (post_directory.updated_at = EXCLUDED.updated_at
              AND post_directory.deleted_at IS NULL AND EXCLUDED.deleted_at IS NOT NULL)`,
      [post.postId, post.authorId, post.title, post.deletedAt, post.updatedAt],
    );
  }
}
