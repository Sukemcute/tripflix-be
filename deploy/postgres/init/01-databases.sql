-- Chạy một lần khi volume Postgres còn trống (docker-entrypoint-initdb.d), bằng superuser.
CREATE DATABASE core;
CREATE DATABASE notification;
