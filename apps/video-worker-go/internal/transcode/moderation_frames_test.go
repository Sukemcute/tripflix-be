package transcode_test

import (
	"bytes"
	"context"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/events"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/storage"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/transcode"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/transcode/faketranscoder"
	"os"
	"testing"
)

func TestFrameSamplingBudget(t *testing.T) {
	for _, duration := range []int{1, 100, 1000, 10000, 300000} {
		times, err := transcode.SampleFrameTimes(duration)
		if err != nil || len(times) > 24 || times[0] != 0 {
			t.Fatalf("sampling %d: %v, %v", duration, times, err)
		}
		for i, ms := range times {
			if ms >= duration || i > 0 && ms <= times[i-1] {
				t.Fatalf("invalid timestamp: %v", times)
			}
		}
	}
	if _, err := transcode.SampleFrameTimes(300001); err == nil {
		t.Fatal("must reject long video")
	}
}
func TestFramesJob(t *testing.T) {
	ctx := context.Background()
	store := storage.NewMemoryStorage("")
	if err := store.PutObject(ctx, storage.PutObjectInput{Key: "source", Body: bytes.NewReader([]byte("video"))}); err != nil {
		t.Fatal(err)
	}
	fake := faketranscoder.New()
	job := transcode.FramesJob{Storage: store, Transcoder: fake, Extract: func(_ context.Context, _, out string, _ int) error { return os.WriteFile(out, []byte("frame"), 0600) }}
	r := events.FramesRequested{AssetID: "11111111-1111-4111-8111-111111111111", RequestID: "22222222-2222-4222-8222-222222222222", SourceKey: "source", HLSPrefix: "video/r1", Policy: events.FramePolicy}
	result, err := job.Run(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	times, _ := transcode.SampleFrameTimes(result.DurationMS)
	if len(result.Frames) != len(times) {
		t.Fatal("missing frame")
	}
	for i, f := range result.Frames {
		if f.TimestampMS != times[i] {
			t.Fatal("wrong timestamp")
		}
		if obj, ok := store.Object(f.Key); !ok || obj.ContentType != "image/jpeg" {
			t.Fatal("missing uploaded frame")
		}
	}
}
