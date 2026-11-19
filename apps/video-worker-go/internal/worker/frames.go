package worker

import (
	"context"
	"errors"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/events"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/streams"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/transcode"
	"time"
)

func (w *Worker) handleFrames(ctx context.Context, event events.Envelope, delivery streams.Delivery) error {
	request, err := events.ParseFramesRequested(event.Payload)
	if err != nil {
		return &streams.PermanentError{Err: err}
	}
	stop := w.consumer.KeepAlive(delivery, w.opts.Heartbeat)
	defer stop()
	jobCtx, cancel := context.WithTimeout(ctx, min(5*time.Minute, w.opts.JobTimeout))
	defer cancel()
	job := transcode.FramesJob{Storage: w.opts.Storage, Transcoder: w.opts.Transcoder, TempDir: w.opts.TempDir, Extract: w.opts.ExtractFrame}
	result, err := job.Run(jobCtx, request)
	if err == nil {
		return w.publish(ctx, event, events.TypeFramesCompleted, result)
	}
	if ctx.Err() != nil || delivery.DeliveryCount < MaxTranscodeAttempts {
		return err
	}
	code := "extraction_failed"
	var frameErr *transcode.FrameError
	if errors.As(err, &frameErr) {
		code = frameErr.Code
	}
	return w.publish(ctx, event, events.TypeFramesFailed, events.FramesFailed{AssetID: request.AssetID, RequestID: request.RequestID, ErrorCode: code})
}
