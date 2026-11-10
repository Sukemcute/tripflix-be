// video-worker chuyển mã video sang HLS: nhận content.media.transcode_requested từ stream:media,
// ghi file lên S3, báo media.rendition.completed từng mức hoặc media.transcode.failed.
package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/config"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/storage"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/transcode"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/worker"
)

func main() {
	if err := run(); err != nil {
		slog.Error("video-worker dừng vì lỗi", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log := newLogger(cfg)
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()

	redisOptions, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return err
	}
	client := redis.NewClient(redisOptions)
	defer client.Close()

	objectStorage, err := storage.NewS3Storage(ctx, cfg.AWSRegion, cfg.Bucket, cfg.KeyPrefix)
	if err != nil {
		return err
	}

	w := worker.New(worker.Options{
		Client:       client,
		ConsumerName: cfg.ConsumerName,
		Storage:      objectStorage,
		Transcoder:   transcode.FFmpeg{},
		Logger:       log,
		JobTimeout:   cfg.JobTimeout,
	})

	// Redis chưa sẵn sàng lúc khởi động thì thử lại, không làm worker dừng.
	for {
		err := w.EnsureGroup(ctx)
		if err == nil {
			break
		}
		if ctx.Err() != nil {
			return nil
		}
		log.Error("Chưa bật được consumer, thử lại sau 5 giây", "err", err)
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(5 * time.Second):
		}
	}
	log.Info("video-worker đã chạy, đang chờ việc từ stream:media", "consumer", cfg.ConsumerName)

	if err := w.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		return err
	}
	log.Info("video-worker dừng")
	return nil
}

// Production ghi JSON một dòng mỗi log, giống pino; máy local ghi dạng dễ đọc.
func newLogger(cfg config.Config) *slog.Logger {
	options := &slog.HandlerOptions{Level: cfg.LogLevel}
	var handler slog.Handler = slog.NewTextHandler(os.Stdout, options)
	if cfg.Production {
		handler = slog.NewJSONHandler(os.Stdout, options)
	}
	return slog.New(handler).With("service", "video-worker")
}
