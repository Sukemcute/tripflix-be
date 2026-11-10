// Package worker nối consumer group "video-worker" với việc chuyển mã: nhận việc từ stream:media,
// gửi kết quả lên cùng stream.
package worker

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/events"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/storage"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/streams"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/transcode"
)

const (
	ConsumerGroup = "video-worker"
	producer      = "video-worker"
	// MaxTranscodeAttempts: lỗi tới lần giao thứ ba thì báo media.transcode.failed rồi XACK.
	MaxTranscodeAttempts = 3
)

type Options struct {
	Client       *redis.Client
	ConsumerName string
	Storage      storage.ObjectStorage
	Transcoder   transcode.Transcoder
	Logger       *slog.Logger
	// Mặc định 2 phút: việc treo lâu hơn thì worker khác nhận lại.
	ClaimIdle time.Duration
	// Mặc định 30 giây: chu kỳ báo còn sống khi đang làm một việc.
	Heartbeat time.Duration
	Block     time.Duration
	// Mặc định 30 phút: một việc chạy quá lâu (FFmpeg treo) thì dừng và tính là một lần lỗi.
	JobTimeout time.Duration
	TempDir    string
}

// Worker không có database nên không có outbox: gửi kết quả xong mới XACK. Chết giữa hai bước thì việc
// được giao lại, bên nhận loại trùng theo (assetId, level).
type Worker struct {
	opts     Options
	consumer *streams.Consumer
}

func New(opts Options) *Worker {
	if opts.ClaimIdle == 0 {
		opts.ClaimIdle = 2 * time.Minute
	}
	if opts.Heartbeat == 0 {
		opts.Heartbeat = 30 * time.Second
	}
	if opts.JobTimeout == 0 {
		opts.JobTimeout = 30 * time.Minute
	}
	if opts.Logger == nil {
		opts.Logger = slog.New(slog.DiscardHandler)
	}
	w := &Worker{opts: opts}
	w.consumer = streams.NewConsumer(streams.ConsumerOptions{
		Client:   opts.Client,
		Group:    ConsumerGroup,
		Consumer: opts.ConsumerName,
		Stream:   streams.Media,
		Handler:  w.handle,
		// Mỗi worker chỉ làm một việc cùng lúc; cần nhiều hơn thì thêm worker.
		BatchSize: 1,
		Block:     opts.Block,
		ClaimIdle: opts.ClaimIdle,
		OnError: func(err error, delivery *streams.Delivery) {
			attrs := []any{"err", err}
			if delivery != nil {
				attrs = append(attrs, "messageId", delivery.MessageID, "deliveryCount", delivery.DeliveryCount)
			}
			opts.Logger.Error("Xử lý việc chuyển mã lỗi, sẽ thử lại", attrs...)
		},
	})
	return w
}

// Run nhận việc tới khi ctx bị huỷ. Huỷ ctx thì dừng FFmpeg đang chạy và không XACK, để việc được giao lại.
func (w *Worker) Run(ctx context.Context) error {
	return w.consumer.Run(ctx)
}

// EnsureGroup tạo consumer group; dùng lúc khởi động để biết Redis đã sẵn sàng.
func (w *Worker) EnsureGroup(ctx context.Context) error {
	return w.consumer.EnsureGroup(ctx)
}

// PollOnce xử lý một vòng; dùng cho test.
func (w *Worker) PollOnce(ctx context.Context) (int, error) {
	return w.consumer.PollOnce(ctx)
}

func (w *Worker) handle(ctx context.Context, event events.Envelope, delivery streams.Delivery) error {
	// stream:media còn chứa kết quả của chính worker; bỏ qua để chúng được XACK.
	if event.Type != events.TypeTranscodeRequested {
		return nil
	}
	request, err := events.ParseTranscodeRequested(event.Payload)
	if err != nil {
		return &streams.PermanentError{Err: err}
	}
	log := w.opts.Logger.With("assetId", request.AssetID, "revision", request.Revision, "deliveryCount", delivery.DeliveryCount)

	stopKeepAlive := w.consumer.KeepAlive(delivery, w.opts.Heartbeat)
	defer stopKeepAlive()

	jobCtx, cancel := context.WithTimeout(ctx, w.opts.JobTimeout)
	defer cancel()
	job := transcode.Job{
		Storage:    w.opts.Storage,
		Transcoder: w.opts.Transcoder,
		TempDir:    w.opts.TempDir,
		Publish: func(ctx context.Context, rendition transcode.Rendition) error {
			if err := w.publish(ctx, event, events.TypeRenditionCompleted, rendition); err != nil {
				return err
			}
			log.Info("Xong một mức chất lượng", "qualityLevel", rendition.Level)
			return nil
		},
	}
	started := time.Now()
	err = job.Run(jobCtx, transcode.Request{AssetID: request.AssetID, SourceKey: request.SourceKey, Revision: request.Revision})
	if err == nil {
		log.Info("Chuyển mã xong", "durationMs", time.Since(started).Milliseconds())
		return nil
	}
	// Worker đang tắt: không báo lỗi, để việc được giao lại.
	if ctx.Err() != nil {
		return err
	}
	if errors.Is(err, context.DeadlineExceeded) {
		err = fmt.Errorf("Chuyển mã quá %s: %w", w.opts.JobTimeout, err)
	}
	if delivery.DeliveryCount < MaxTranscodeAttempts {
		return err
	}
	return w.publishFailure(ctx, log, event, request.AssetID, err, delivery.DeliveryCount)
}

func (w *Worker) publishFailure(ctx context.Context, log *slog.Logger, cause events.Envelope, assetID string, jobErr error, attempts int64) error {
	level := transcode.QualityRungs[0].Level
	var levelErr *transcode.LevelError
	if errors.As(jobErr, &levelErr) {
		level = levelErr.Level
	}
	payload := events.TranscodeFailed{AssetID: assetID, Level: level, Reason: events.FailureReason(jobErr), Attempts: int(attempts)}
	if err := w.publish(ctx, cause, events.TypeTranscodeFailed, payload); err != nil {
		return err
	}
	log.Error("Chuyển mã lỗi quá số lần thử", "qualityLevel", level, "attempts", attempts, "err", jobErr)
	return nil
}

func (w *Worker) publish(ctx context.Context, cause events.Envelope, eventType string, payload any) error {
	envelope, err := events.New(eventType, producer, cause, payload)
	if err != nil {
		return err
	}
	return streams.Publish(ctx, w.opts.Client, streams.Media, envelope)
}
