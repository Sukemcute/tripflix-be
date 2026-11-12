import type pg from 'pg';

export async function ensureInboxSchema(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('tripflix.notification.migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS __migrations (
        version integer PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const migration = await client.query('SELECT 1 FROM __migrations WHERE version = 1');
    if (migration.rowCount === 0) {
      await client.query(INITIAL_NOTIFICATION_SCHEMA);
      await client.query('INSERT INTO __migrations (version) VALUES (1)');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const INITIAL_NOTIFICATION_SCHEMA = `
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

    ALTER TABLE inbox ADD COLUMN IF NOT EXISTS group_key text;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_event_user_type
      ON inbox (source_event_id, user_id, type);

    CREATE TABLE IF NOT EXISTS deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      inbox_id uuid REFERENCES inbox (id),
      user_id uuid NOT NULL,
      channel text NOT NULL CONSTRAINT ck_deliveries_channel CHECK (channel IN ('email', 'push')),
      status text NOT NULL DEFAULT 'pending'
        CONSTRAINT ck_deliveries_status CHECK (status IN ('pending', 'sent', 'failed')),
      attempts integer NOT NULL DEFAULT 0 CONSTRAINT ck_deliveries_attempts CHECK (attempts >= 0),
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS user_directory (
      user_id uuid PRIMARY KEY,
      display_name text NOT NULL,
      email text,
      avatar_url text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS post_directory (
      post_id uuid PRIMARY KEY,
      author_id uuid NOT NULL,
      title text,
      deleted_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
`;
