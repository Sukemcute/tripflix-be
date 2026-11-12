import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type pg from 'pg';
import { z } from 'zod';
import { DB } from '../tokens.js';
import { ensureInboxSchema } from './inbox.schema.js';

export interface InboxRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  data: Record<string, unknown>;
  source_event_id: string;
  created_at: Date;
  read_at: Date | null;
}

export interface InboxInsert {
  userId: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  data: Record<string, unknown>;
  sourceEventId: string;
}

export interface InboxItemDto {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

export function toInboxItemDto(row: InboxRow): InboxItemDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    data: row.data,
    createdAt: row.created_at.toISOString(),
    readAt: row.read_at?.toISOString() ?? null,
  };
}

const InboxCursorSchema = z.tuple([z.iso.datetime(), z.uuid()]);

export function encodeInboxCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify(InboxCursorSchema.parse([createdAt, id]))).toString('base64url');
}

export function decodeInboxCursor(cursor: string): [string, string] {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('Con trỏ không hợp lệ');
  const bytes = Buffer.from(cursor, 'base64url');
  if (bytes.toString('base64url') !== cursor) throw new Error('Con trỏ không hợp lệ');
  return InboxCursorSchema.parse(JSON.parse(bytes.toString('utf8')));
}

@Injectable()
export class InboxRepository implements OnModuleInit {
  constructor(@Inject(DB) private readonly pool: pg.Pool) {}

  async onModuleInit(): Promise<void> {
    await ensureInboxSchema(this.pool);
  }

  async insert(item: InboxInsert): Promise<InboxRow | null> {
    const result = await this.pool.query<InboxRow>(
      `
      INSERT INTO inbox (user_id, type, title, body, link, data, source_event_id)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
      ON CONFLICT DO NOTHING RETURNING *
    `,
      [
        item.userId,
        item.type,
        item.title,
        item.body,
        item.link,
        JSON.stringify(item.data),
        item.sourceEventId,
      ],
    );
    return result.rows[0] ?? null;
  }

  async listForUser(
    userId: string,
    options: { cursor?: string; limit: number },
  ): Promise<{
    items: InboxRow[];
    nextCursor: string | null;
  }> {
    const cursor = options.cursor === undefined ? null : decodeInboxCursor(options.cursor);
    const result = await this.pool.query<InboxRow & { cursor_created_at: string }>(
      `
      SELECT *, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
      FROM inbox WHERE user_id = $1
        AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
      ORDER BY created_at DESC, id DESC LIMIT $4
    `,
      [userId, cursor?.[0] ?? null, cursor?.[1] ?? null, options.limit + 1],
    );
    const items = result.rows.slice(0, options.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        result.rows.length > options.limit && last
          ? encodeInboxCursor(last.cursor_created_at, last.id)
          : null,
    };
  }

  async countUnread(userId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      'SELECT count(*) AS count FROM inbox WHERE user_id = $1 AND read_at IS NULL',
      [userId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async markRead(userId: string, id: string): Promise<boolean> {
    const result = await this.pool.query(
      'UPDATE inbox SET read_at = COALESCE(read_at, now()) WHERE user_id = $1 AND id = $2',
      [userId, id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await this.pool.query(
      'UPDATE inbox SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
      [userId],
    );
    return result.rowCount ?? 0;
  }
}
