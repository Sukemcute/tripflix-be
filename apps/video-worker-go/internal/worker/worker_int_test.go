package worker_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/events"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/storage"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/streams"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/transcode"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/transcode/faketranscoder"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/worker"
)

const ownerID = "22222222-2222-4222-8222-222222222222"

// Test chạy trên Redis thật, chỉ khi có TEST_REDIS_URL. Mỗi test xoá sạch database đó.
func connect(t *testing.T) *redis.Client {
	t.Helper()
	url := os.Getenv("TEST_REDIS_URL")
	if url == "" {
		t.Skip("đặt TEST_REDIS_URL, ví dụ redis://localhost:6390/15, để chạy test trên Redis thật")
	}
	options, err := redis.ParseURL(url)
	if err != nil {
		t.Fatal(err)
	}
	client := redis.NewClient(options)
	t.Cleanup(func() { client.Close() })
	if err := client.FlushDB(context.Background()).Err(); err != nil {
		t.Fatal(err)
	}
	return client
}

type harness struct {
	client     *redis.Client
	transcoder *faketranscoder.Fake
	assetID    string
	sourceKey  string
	worker     *worker.Worker
	cancel     context.CancelFunc
	done       chan struct{}
}

func newHarness(t *testing.T, transcoder *faketranscoder.Fake, claimIdle, heartbeat time.Duration) *harness {
	t.Helper()
	client := connect(t)
	h := &harness{client: client, transcoder: transcoder, assetID: "33333333-3333-4333-8333-" + time.Now().Format("150405000000")}
	h.sourceKey = "dev/test/uploads/" + h.assetID + "/original.mp4"
	objectStorage := storage.NewMemoryStorage("dev/test/")
	if err := objectStorage.PutObject(context.Background(), storage.PutObjectInput{Key: h.sourceKey, Body: strings.NewReader("video"), ContentType: "video/mp4"}); err != nil {
		t.Fatal(err)
	}
	h.worker = worker.New(worker.Options{
		Client:       client,
		ConsumerName: "worker-1",
		Storage:      objectStorage,
		Transcoder:   transcoder,
		ClaimIdle:    claimIdle,
		Heartbeat:    heartbeat,
		Block:        50 * time.Millisecond,
		TempDir:      t.TempDir(),
	})
	t.Cleanup(h.stop)
	return h
}

func (h *harness) start() {
	ctx, cancel := context.WithCancel(context.Background())
	h.cancel, h.done = cancel, make(chan struct{})
	go func() {
		defer close(h.done)
		_ = h.worker.Run(ctx)
	}()
}

func (h *harness) stop() {
	if h.cancel != nil {
		h.cancel()
		<-h.done
		h.cancel = nil
	}
}

func (h *harness) publish(t *testing.T, eventType string, payload any) {
	t.Helper()
	body, _ := json.Marshal(payload)
	userID := ownerID
	envelope := events.Envelope{
		EventID:    "5f3c7d2a-1b4e-4c8f-9a0b-2d6e8f1a3c5b",
		Type:       eventType,
		Version:    1,
		OccurredAt: time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		Producer:   "core-api/content",
		UserID:     &userID,
		Payload:    body,
	}
	if err := streams.Publish(context.Background(), h.client, streams.Media, envelope); err != nil {
		t.Fatal(err)
	}
}

func (h *harness) request() map[string]any {
	return map[string]any{"assetId": h.assetID, "sourceKey": h.sourceKey, "revision": 1}
}

func (h *harness) results(t *testing.T, eventType string) []events.Envelope {
	t.Helper()
	entries, err := h.client.XRange(context.Background(), streams.Media, "-", "+").Result()
	if err != nil {
		t.Fatal(err)
	}
	var out []events.Envelope
	for _, entry := range entries {
		envelope, err := events.ParseEnvelope(entry.Values["event"].(string))
		if err != nil {
			t.Fatalf("sự kiện không hợp lệ: %v", err)
		}
		if envelope.Type == eventType {
			out = append(out, envelope)
		}
	}
	return out
}

func (h *harness) pending(t *testing.T) int64 {
	t.Helper()
	summary, err := h.client.XPending(context.Background(), streams.Media, worker.ConsumerGroup).Result()
	if err != nil {
		t.Fatal(err)
	}
	return summary.Count
}

func waitFor(t *testing.T, timeout time.Duration, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("hết %s mà chưa thấy: %s", timeout, what)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func payloadOf[T any](t *testing.T, envelope events.Envelope) T {
	t.Helper()
	var payload T
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	return payload
}

func TestNhanViecPhatKetQuaTungMucRoiXack(t *testing.T) {
	h := newHarness(t, faketranscoder.New(), 0, 0)
	h.publish(t, events.TypeTranscodeRequested, h.request())
	h.start()

	waitFor(t, 15*time.Second, "3 kết quả", func() bool { return len(h.results(t, events.TypeRenditionCompleted)) == 3 })
	results := h.results(t, events.TypeRenditionCompleted)
	var levels []int
	for _, result := range results {
		levels = append(levels, payloadOf[transcode.Rendition](t, result).Level)
	}
	if !slices.Equal(levels, []int{360, 540, 720}) {
		t.Errorf("thứ tự mức: %v", levels)
	}
	first := payloadOf[transcode.Rendition](t, results[0])
	want := transcode.Rendition{AssetID: h.assetID, Level: 360, HLSPrefix: "dev/test/videos/" + h.assetID + "/r1", DurationSec: 43, Aspect: "9:16"}
	if first != want || results[0].Producer != "video-worker" || results[0].UserID == nil || *results[0].UserID != ownerID {
		t.Errorf("kết quả đầu: %+v, %+v", results[0], first)
	}
	waitFor(t, 5*time.Second, "XACK", func() bool { return h.pending(t) == 0 })
}

func TestBoQuaSuKienKhacVanXack(t *testing.T) {
	transcoder := faketranscoder.New()
	h := newHarness(t, transcoder, 0, 0)
	h.publish(t, events.TypeRenditionCompleted, map[string]any{"assetId": h.assetID, "level": 360})
	h.start()

	waitFor(t, 5*time.Second, "đã đọc và XACK", func() bool {
		groups, err := h.client.XInfoGroups(context.Background(), streams.Media).Result()
		return err == nil && len(groups) == 1 && groups[0].EntriesRead == 1 && groups[0].Pending == 0
	})
	if got := transcoder.EncodedLevels(); len(got) != 0 {
		t.Errorf("vẫn chuyển mã %v", got)
	}
}

func TestLoiThuDuBaLanRoiBaoFailedVaXack(t *testing.T) {
	transcoder := faketranscoder.New()
	transcoder.FailOn(360, true)
	h := newHarness(t, transcoder, 100*time.Millisecond, 0)
	h.publish(t, events.TypeTranscodeRequested, h.request())
	h.start()

	waitFor(t, 20*time.Second, "media.transcode.failed", func() bool { return len(h.results(t, events.TypeTranscodeFailed)) == 1 })
	failure := payloadOf[events.TranscodeFailed](t, h.results(t, events.TypeTranscodeFailed)[0])
	want := events.TranscodeFailed{AssetID: h.assetID, Level: 360, Reason: "FFmpeg lỗi giả ở 360p", Attempts: worker.MaxTranscodeAttempts}
	if failure != want {
		t.Errorf("được %+v", failure)
	}
	waitFor(t, 5*time.Second, "XACK", func() bool { return h.pending(t) == 0 })
	if n := len(h.results(t, events.TypeRenditionCompleted)); n != 0 {
		t.Errorf("có %d kết quả dù 360p lỗi", n)
	}
}

func TestXong360pMaMucCaoLoiThiGiu360pVaBaoDungMuc(t *testing.T) {
	transcoder := faketranscoder.New()
	transcoder.FailOn(540, true)
	h := newHarness(t, transcoder, 100*time.Millisecond, 0)
	h.publish(t, events.TypeTranscodeRequested, h.request())
	h.start()

	waitFor(t, 20*time.Second, "media.transcode.failed", func() bool { return len(h.results(t, events.TypeTranscodeFailed)) == 1 })
	if level := payloadOf[events.TranscodeFailed](t, h.results(t, events.TypeTranscodeFailed)[0]).Level; level != 540 {
		t.Errorf("mức lỗi %d", level)
	}
	for _, result := range h.results(t, events.TypeRenditionCompleted) {
		if level := payloadOf[transcode.Rendition](t, result).Level; level != 360 {
			t.Errorf("báo xong mức %d", level)
		}
	}
	if got := transcoder.EncodedLevels(); !slices.Equal(got, []int{360}) {
		t.Errorf("chuyển mã %v: 360p bị làm lại", got)
	}
}

func TestDangLamLauThiBaoConSongKhongBiNhanLai(t *testing.T) {
	transcoder := faketranscoder.New()
	var maxDeliveries atomic.Int64
	var once sync.Once
	var client *redis.Client
	transcoder.BeforeEncode = func(ctx context.Context, _ transcode.EncodeLevelInput) error {
		once.Do(func() {
			// Lâu gấp ba claimIdle. Không báo còn sống thì việc đã bị nhận lại.
			for range 15 {
				time.Sleep(100 * time.Millisecond)
				rows, err := client.XPendingExt(ctx, &redis.XPendingExtArgs{Stream: streams.Media, Group: worker.ConsumerGroup, Start: "-", End: "+", Count: 1}).Result()
				if err == nil && len(rows) > 0 && rows[0].RetryCount > maxDeliveries.Load() {
					maxDeliveries.Store(rows[0].RetryCount)
				}
			}
		})
		return nil
	}
	h := newHarness(t, transcoder, 500*time.Millisecond, 100*time.Millisecond)
	client = h.client
	h.publish(t, events.TypeTranscodeRequested, h.request())
	h.start()

	waitFor(t, 15*time.Second, "3 kết quả", func() bool { return len(h.results(t, events.TypeRenditionCompleted)) == 3 })
	if got := maxDeliveries.Load(); got != 1 {
		t.Errorf("số lần giao lên %d", got)
	}
	if got := transcoder.EncodedLevels(); !slices.Equal(got, []int{360, 540, 720}) {
		t.Errorf("chuyển mã %v", got)
	}
}

func TestDungWorkerGiuaChungThiKhongXackVaKhongBaoLoi(t *testing.T) {
	transcoder := faketranscoder.New()
	started := make(chan struct{})
	var once sync.Once
	transcoder.BeforeEncode = func(ctx context.Context, _ transcode.EncodeLevelInput) error {
		once.Do(func() { close(started) })
		<-ctx.Done()
		return errors.New("FFmpeg bị dừng")
	}
	h := newHarness(t, transcoder, 0, 0)
	h.publish(t, events.TypeTranscodeRequested, h.request())
	h.start()

	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("worker chưa nhận việc")
	}
	h.stop()

	if n := h.pending(t); n != 1 {
		t.Errorf("pending %d, cần 1", n)
	}
	if n := len(h.results(t, events.TypeTranscodeFailed)); n != 0 {
		t.Errorf("vẫn báo lỗi %d lần", n)
	}
}

func TestPayloadSaiThiVaoDeadLetterNgay(t *testing.T) {
	transcoder := faketranscoder.New()
	h := newHarness(t, transcoder, 0, 0)
	h.publish(t, events.TypeTranscodeRequested, map[string]any{"assetId": "không-phải-uuid", "sourceKey": "k", "revision": 1})
	if err := h.client.XAdd(context.Background(), &redis.XAddArgs{Stream: streams.Media, Values: []any{"event", "{không phải json"}}).Err(); err != nil {
		t.Fatal(err)
	}
	h.start()

	waitFor(t, 5*time.Second, "2 dòng dead-letter", func() bool {
		n, err := h.client.XLen(context.Background(), streams.DeadLetter).Result()
		return err == nil && n == 2
	})
	waitFor(t, 5*time.Second, "XACK", func() bool { return h.pending(t) == 0 })
	dead, _ := h.client.XRange(context.Background(), streams.DeadLetter, "-", "+").Result()
	if reason := dead[0].Values["reason"]; reason != "assetId không phải UUID" || dead[0].Values["group"] != worker.ConsumerGroup {
		t.Errorf("dead-letter: %+v", dead[0].Values)
	}
	if got := transcoder.EncodedLevels(); len(got) != 0 {
		t.Errorf("vẫn chuyển mã %v", got)
	}
}

func TestQuaThoiGianChoPhepThiTinhLaLoi(t *testing.T) {
	transcoder := faketranscoder.New()
	transcoder.BeforeEncode = func(ctx context.Context, _ transcode.EncodeLevelInput) error {
		<-ctx.Done()
		return ctx.Err()
	}
	client := connect(t)
	objectStorage := storage.NewMemoryStorage("dev/test/")
	assetID := "44444444-4444-4444-8444-444444444444"
	sourceKey := "dev/test/uploads/" + assetID + "/original.mp4"
	_ = objectStorage.PutObject(context.Background(), storage.PutObjectInput{Key: sourceKey, Body: strings.NewReader("video"), ContentType: "video/mp4"})
	w := worker.New(worker.Options{
		Client: client, ConsumerName: "worker-1", Storage: objectStorage, Transcoder: transcoder,
		ClaimIdle: 50 * time.Millisecond, Block: 50 * time.Millisecond, JobTimeout: 100 * time.Millisecond, TempDir: t.TempDir(),
	})
	h := &harness{client: client, worker: w}
	t.Cleanup(h.stop)
	h.publish(t, events.TypeTranscodeRequested, map[string]any{"assetId": assetID, "sourceKey": sourceKey, "revision": 1})
	h.start()

	waitFor(t, 20*time.Second, "media.transcode.failed", func() bool { return len(h.results(t, events.TypeTranscodeFailed)) == 1 })
	failure := payloadOf[events.TranscodeFailed](t, h.results(t, events.TypeTranscodeFailed)[0])
	if !strings.HasPrefix(failure.Reason, "Chuyển mã quá 100ms") || failure.Attempts != worker.MaxTranscodeAttempts {
		t.Errorf("được %+v", failure)
	}
}
