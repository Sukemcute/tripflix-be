-- Extension cho tìm kiếm (discovery): full-text không dấu, tìm gần đúng, vector.
\connect core
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
