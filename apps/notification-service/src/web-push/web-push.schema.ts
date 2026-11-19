export const WEB_PUSH_SCHEMA = `
CREATE TABLE web_push_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), endpoint text NOT NULL UNIQUE,
 user_id uuid NOT NULL, session_id uuid NOT NULL, p256dh text NOT NULL, auth text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX idx_web_push_subscriptions_user_id ON web_push_subscriptions(user_id);
CREATE INDEX idx_web_push_subscriptions_expires_at ON web_push_subscriptions(expires_at);
CREATE INDEX idx_follower_posts_web_push_created_at ON follower_post_jobs(shared_created_at) WHERE state='done' AND shared_created_at IS NOT NULL;
CREATE TABLE web_push_deliveries (
 subscription_id uuid NOT NULL REFERENCES web_push_subscriptions(id) ON DELETE CASCADE ON UPDATE CASCADE,
 notification_id uuid NOT NULL, attempts integer NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
 available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(subscription_id, notification_id)
);
CREATE INDEX idx_web_push_deliveries_created_at ON web_push_deliveries(created_at);
`;
