-- Mỗi module một user Postgres, chỉ có quyền trên schema của mình, nên query chéo schema lỗi ngay ở dev.
-- Mật khẩu dưới đây CHỈ dùng cho máy local.
CREATE ROLE tf_access LOGIN PASSWORD 'tf_access_dev';
CREATE ROLE tf_content LOGIN PASSWORD 'tf_content_dev';
CREATE ROLE tf_discovery LOGIN PASSWORD 'tf_discovery_dev';
CREATE ROLE tf_analytics LOGIN PASSWORD 'tf_analytics_dev';
CREATE ROLE tf_commerce LOGIN PASSWORD 'tf_commerce_dev';
CREATE ROLE tf_notification LOGIN PASSWORD 'tf_notification_dev';

-- Ai được kết nối database nào
REVOKE CONNECT ON DATABASE core, commerce, notification FROM PUBLIC;
GRANT CONNECT ON DATABASE core TO tf_access, tf_content, tf_discovery, tf_analytics;
GRANT CONNECT ON DATABASE commerce TO tf_commerce;
GRANT CONNECT ON DATABASE notification TO tf_notification;

\connect core
CREATE SCHEMA access AUTHORIZATION tf_access;
CREATE SCHEMA content AUTHORIZATION tf_content;
CREATE SCHEMA discovery AUTHORIZATION tf_discovery;
CREATE SCHEMA analytics AUTHORIZATION tf_analytics;
ALTER ROLE tf_access IN DATABASE core SET search_path = access, public;
ALTER ROLE tf_content IN DATABASE core SET search_path = content, public;
ALTER ROLE tf_discovery IN DATABASE core SET search_path = discovery, public;
ALTER ROLE tf_analytics IN DATABASE core SET search_path = analytics, public;

\connect commerce
CREATE SCHEMA commerce AUTHORIZATION tf_commerce;
ALTER ROLE tf_commerce IN DATABASE commerce SET search_path = commerce, public;

\connect notification
CREATE SCHEMA notification AUTHORIZATION tf_notification;
ALTER ROLE tf_notification IN DATABASE notification SET search_path = notification, public;
