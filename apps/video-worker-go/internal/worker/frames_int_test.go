package worker_test

import (
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/events"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/transcode/faketranscoder"
	"testing"
	"time"
)

func TestFramesRequestAndAck(t *testing.T) {
	h := newHarness(t, faketranscoder.New(), 100*time.Millisecond, 0)
	h.publish(t, events.TypeFramesRequested, events.FramesRequested{AssetID: h.assetID, RequestID: "11111111-1111-4111-8111-111111111111", SourceKey: h.sourceKey, HLSPrefix: "videos/r1", Policy: events.FramePolicy})
	h.start()
	waitFor(t, 15*time.Second, "frame result", func() bool { return len(h.results(t, events.TypeFramesCompleted)) == 1 })
	result := payloadOf[events.FramesCompleted](t, h.results(t, events.TypeFramesCompleted)[0])
	if len(result.Frames) < 3 || result.Frames[0].TimestampMS != 0 {
		t.Fatal("invalid sampling")
	}
	if len(h.results(t, events.TypeRenditionCompleted)) > 0 {
		t.Fatal("frame request ran transcoding")
	}
	waitFor(t, 5*time.Second, "ACK", func() bool { return h.pending(t) == 0 })
}
func TestFramesFailureDoesNotFailPlayableVideo(t *testing.T) {
	fake := faketranscoder.New()
	fake.Video.DurationSeconds = 301
	h := newHarness(t, fake, 100*time.Millisecond, 0)
	h.publish(t, events.TypeFramesRequested, events.FramesRequested{AssetID: h.assetID, RequestID: "11111111-1111-4111-8111-111111111111", SourceKey: h.sourceKey, HLSPrefix: "videos/r1", Policy: events.FramePolicy})
	h.start()
	waitFor(t, 20*time.Second, "frame failure", func() bool { return len(h.results(t, events.TypeFramesFailed)) == 1 })
	if payloadOf[events.FramesFailed](t, h.results(t, events.TypeFramesFailed)[0]).ErrorCode != "video_too_long" {
		t.Fatal("wrong failure")
	}
	if len(h.results(t, events.TypeTranscodeFailed)) > 0 {
		t.Fatal("extraction must not fail video")
	}
}
