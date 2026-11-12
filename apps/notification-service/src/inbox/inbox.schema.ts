import type pg from 'pg';

export async function ensureInboxSchema(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inbox (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      type text NOT NULL,
      title text NOT NULL,
      body text NOT NULL,
      link text NULL,
      data jsonb NOT NULL DEFAULT '{}',
      source_event_id text NOT NULL CONSTRAINT uq_inbox_source_event_id UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      read_at timestamptz NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inbox_user_id_created_at ON inbox (user_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_inbox_user_id_unread ON inbox (user_id) WHERE read_at IS NULL;
  `);
}
