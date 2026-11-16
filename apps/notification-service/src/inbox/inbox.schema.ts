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
    for (const [version, sql] of NOTIFICATION_MIGRATIONS) {
      const migration = await client.query('SELECT 1 FROM __migrations WHERE version = $1', [version]);
      if (migration.rowCount === 0) {
        await client.query(sql);
        await client.query('INSERT INTO __migrations (version) VALUES ($1)', [version]);
      }
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

const COMMENT_NOTIFICATIONS_SCHEMA = `
  ALTER TABLE inbox ADD COLUMN comment_id uuid, ADD COLUMN deleted_at timestamptz;
  CREATE INDEX idx_inbox_comment_id ON inbox (comment_id) WHERE comment_id IS NOT NULL;
  CREATE TABLE deleted_notification_comments (comment_id uuid PRIMARY KEY, deleted_at timestamptz NOT NULL);
`;

const REACTION_NOTIFICATIONS_SCHEMA = `
  CREATE UNIQUE INDEX uq_inbox_group_key ON inbox (group_key COLLATE "C") WHERE group_key IS NOT NULL;
  CREATE TABLE reaction_notification_actors (
    user_id uuid NOT NULL,
    type text NOT NULL,
    target_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    inbox_id uuid REFERENCES inbox (id),
    is_active boolean NOT NULL,
    occurred_at timestamptz NOT NULL,
    event_id text NOT NULL,
    PRIMARY KEY (user_id, type, target_id, actor_id)
  );
`;

const POST_MODERATION_NOTIFICATIONS_SCHEMA = `
  ALTER TABLE inbox ADD COLUMN interaction_occurred_at timestamptz,
    ADD COLUMN is_post_interaction_suppressed boolean NOT NULL DEFAULT false;
  CREATE INDEX idx_inbox_unsuppressed_interaction_post ON inbox ((data->>'postId'))
    WHERE NOT is_post_interaction_suppressed AND (type LIKE 'comment.%' OR type LIKE 'reaction.%');
  CREATE TABLE post_notification_moderation (
    post_id uuid PRIMARY KEY,
    changed_at timestamptz NOT NULL,
    is_hidden boolean NOT NULL
  );
`;

const FOLLOWER_POST_JOBS_SCHEMA = `
  CREATE TABLE follower_post_jobs (
    post_id uuid PRIMARY KEY,
    author_id uuid NOT NULL,
    cursor uuid,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'failed', 'cancelled')),
    attempts integer NOT NULL DEFAULT 0,
    available_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX idx_follower_post_jobs_available ON follower_post_jobs (available_at, post_id) WHERE state = 'pending';
`;

const SHARED_FOLLOWER_POSTS_SCHEMA = `
  CREATE TABLE notification_follows (
    follower_id uuid NOT NULL,
    author_id uuid NOT NULL,
    followed_at timestamptz,
    changed_at timestamptz NOT NULL,
    PRIMARY KEY (follower_id, author_id)
  );
  ALTER TABLE follower_post_jobs ADD COLUMN shared_published_at timestamptz;
  ALTER TABLE follower_post_jobs ADD COLUMN shared_created_at timestamptz;
  CREATE INDEX idx_follower_posts_shared_author ON follower_post_jobs (author_id, shared_created_at DESC, post_id)
    WHERE state = 'done' AND shared_created_at IS NOT NULL;
  CREATE TABLE shared_follower_post_reads (
    user_id uuid NOT NULL,
    post_id uuid NOT NULL REFERENCES follower_post_jobs(post_id),
    read_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, post_id)
  );
`;

// Người theo dõi luồng trả lời (N2): tác giả bình luận gốc và mọi người đã trả lời trong luồng.
const THREAD_PARTICIPANTS_SCHEMA = `
  CREATE TABLE thread_participants (
    parent_comment_id uuid NOT NULL,
    user_id uuid NOT NULL,
    joined_at timestamptz NOT NULL,
    PRIMARY KEY (parent_comment_id, user_id)
  );
`;

// Người theo dõi bài đã bình luận (N1) và job báo bình luận gốc mới theo lô.
const POST_WATCHERS_SCHEMA = `
  CREATE TABLE post_watchers (
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    is_muted boolean NOT NULL DEFAULT false,
    changed_at timestamptz NOT NULL,
    PRIMARY KEY (post_id, user_id)
  );
  CREATE TABLE post_watch_jobs (
    comment_id uuid PRIMARY KEY,
    post_id uuid NOT NULL,
    post_author_id uuid NOT NULL,
    author_id uuid NOT NULL,
    author_display_name text,
    event_id text NOT NULL,
    occurred_at timestamptz NOT NULL,
    cursor uuid,
    state text NOT NULL DEFAULT 'pending'
      CONSTRAINT ck_post_watch_jobs_state CHECK (state IN ('pending', 'done', 'failed', 'cancelled')),
    attempts integer NOT NULL DEFAULT 0,
    available_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX idx_post_watch_jobs_available ON post_watch_jobs (available_at, comment_id) WHERE state = 'pending';
`;

// Push mobile (N3). inbox.updated_at chỉ đổi khi tiêu đề/nội dung đổi (dòng mới hoặc dòng gom có thêm người);
// dòng cũ để NULL để lần triển khai đầu không đẩy lại thông báo cũ.
const PUSH_SCHEMA = `
  CREATE TABLE push_tokens (
    token text PRIMARY KEY,
    user_id uuid NOT NULL,
    platform text NOT NULL CONSTRAINT ck_push_tokens_platform CHECK (platform IN ('android', 'ios')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX idx_push_tokens_user_id ON push_tokens (user_id, updated_at DESC);

  ALTER TABLE inbox ADD COLUMN updated_at timestamptz;
  ALTER TABLE inbox ALTER COLUMN updated_at SET DEFAULT now();
  CREATE FUNCTION touch_inbox_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    NEW.updated_at := now();
    RETURN NEW;
  END
  $$;
  CREATE TRIGGER trg_inbox_touch_updated_at BEFORE UPDATE OF title, body ON inbox
    FOR EACH ROW WHEN (OLD.title IS DISTINCT FROM NEW.title OR OLD.body IS DISTINCT FROM NEW.body)
    EXECUTE FUNCTION touch_inbox_updated_at();
  CREATE INDEX idx_inbox_push_pending ON inbox (updated_at)
    WHERE updated_at IS NOT NULL AND read_at IS NULL AND deleted_at IS NULL;

  CREATE UNIQUE INDEX uq_deliveries_inbox_push ON deliveries (inbox_id) WHERE channel = 'push';
`;

const NOTIFICATION_MIGRATIONS = [
  [1, INITIAL_NOTIFICATION_SCHEMA],
  [2, 'ALTER TABLE inbox DROP CONSTRAINT IF EXISTS uq_inbox_source_event_id'],
  [3, COMMENT_NOTIFICATIONS_SCHEMA],
  [4, REACTION_NOTIFICATIONS_SCHEMA],
  [5, POST_MODERATION_NOTIFICATIONS_SCHEMA],
  [6, FOLLOWER_POST_JOBS_SCHEMA],
  [7, SHARED_FOLLOWER_POSTS_SCHEMA],
  [8, THREAD_PARTICIPANTS_SCHEMA],
  [9, POST_WATCHERS_SCHEMA],
  [10, PUSH_SCHEMA],
] as const;
