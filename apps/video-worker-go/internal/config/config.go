// Package config đọc biến môi trường, cùng tên và giá trị mặc định với bản TypeScript.
package config

import (
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"
)

type Config struct {
	Production   bool
	LogLevel     slog.Level
	RedisURL     string
	AWSRegion    string
	Bucket       string
	KeyPrefix    string
	ConsumerName string
	JobTimeout   time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		RedisURL:     env("REDIS_URL", "redis://localhost:6379"),
		AWSRegion:    env("AWS_REGION", "ap-southeast-2"),
		Bucket:       env("S3_MEDIA_BUCKET", "tripflix-media-dev"),
		KeyPrefix:    env("S3_KEY_PREFIX", "dev/unknown/"),
		ConsumerName: os.Getenv("VIDEO_WORKER_CONSUMER_NAME"),
	}

	switch nodeEnv := env("NODE_ENV", "development"); nodeEnv {
	case "production":
		cfg.Production = true
	case "development", "test":
	default:
		return Config{}, fmt.Errorf("NODE_ENV không hợp lệ: %q", nodeEnv)
	}

	// Cùng tên mức với pino; Go không có fatal, trace nên gộp vào error, debug.
	switch level := env("LOG_LEVEL", "info"); level {
	case "fatal", "error":
		cfg.LogLevel = slog.LevelError
	case "warn":
		cfg.LogLevel = slog.LevelWarn
	case "info":
		cfg.LogLevel = slog.LevelInfo
	case "debug", "trace":
		cfg.LogLevel = slog.LevelDebug
	default:
		return Config{}, fmt.Errorf("LOG_LEVEL không hợp lệ: %q", level)
	}

	timeout, err := time.ParseDuration(env("VIDEO_WORKER_JOB_TIMEOUT", "30m"))
	if err != nil || timeout <= 0 {
		return Config{}, fmt.Errorf("VIDEO_WORKER_JOB_TIMEOUT không hợp lệ, ví dụ đúng: 30m")
	}
	cfg.JobTimeout = timeout

	if cfg.ConsumerName == "" {
		// Mỗi replica một tên để Redis chia việc.
		hostname, err := os.Hostname()
		if err != nil {
			return Config{}, fmt.Errorf("không lấy được tên máy, đặt VIDEO_WORKER_CONSUMER_NAME: %w", err)
		}
		cfg.ConsumerName = hostname
	}
	return cfg, nil
}

func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}
