package transcode_test

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/events"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/storage"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/transcode"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestRealModerationFramesFindMiddleScene(t *testing.T) {
	requireFFmpeg(t)
	dir := t.TempDir()
	source := filepath.Join(dir, "source.mp4")
	runTool(t, "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "color=c=blue:s=320x240:d=2:r=10",
		"-f", "lavfi", "-i", "color=c=red:s=320x240:d=2:r=10",
		"-f", "lavfi", "-i", "color=c=blue:s=320x240:d=2:r=10",
		"-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-c:v", "libx264", "-threads", "1", source)
	body, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	store := storage.NewMemoryStorage("")
	if err := store.PutObject(ctx, storage.PutObjectInput{Key: "source", Body: bytes.NewReader(body)}); err != nil {
		t.Fatal(err)
	}
	job := transcode.FramesJob{Storage: store, Transcoder: transcode.FFmpeg{}}
	result, err := job.Run(ctx, events.FramesRequested{AssetID: "11111111-1111-4111-8111-111111111111", RequestID: "22222222-2222-4222-8222-222222222222", SourceKey: "source", HLSPrefix: "videos/r1", Policy: events.FramePolicy})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Frames) != 3 || result.Frames[1].TimestampMS != 2950 {
		t.Fatalf("unexpected manifest: %+v", result)
	}
	for i, frame := range result.Frames {
		object, ok := store.Object(frame.Key)
		if !ok {
			t.Fatal("missing frame")
		}
		out := filepath.Join(dir, "frame.jpg")
		if err := os.WriteFile(out, object.Body, 0600); err != nil {
			t.Fatal(err)
		}
		rgb, err := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error", "-i", out, "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1").Output()
		if err != nil || len(rgb) < 3 {
			t.Fatalf("decode frame %d: %v", i, err)
		}
		if i == 1 && (rgb[0] < 180 || rgb[2] > 50) {
			t.Fatalf("middle scene not red: %v", rgb)
		}
		if i != 1 && (rgb[2] < 180 || rgb[0] > 50) {
			t.Fatalf("edge scene not blue: %v", rgb)
		}
	}

	if artifactDir := os.Getenv("BE09_FRAME_PROOF_DIR"); artifactDir != "" {
		if err := os.MkdirAll(artifactDir, 0700); err != nil {
			t.Fatal(err)
		}
		encoded, err := json.MarshalIndent(result, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(artifactDir, "manifest.json"), encoded, 0600); err != nil {
			t.Fatal(err)
		}
		for _, frame := range result.Frames {
			obj, _ := store.Object(frame.Key)
			if err := os.WriteFile(filepath.Join(artifactDir, filepath.Base(frame.Key)), obj.Body, 0600); err != nil {
				t.Fatal(err)
			}
		}
		runTool(t, "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", source, "-map_metadata", "-1", "-c", "copy", "-hls_time", "2", "-hls_playlist_type", "vod", "-hls_segment_filename", filepath.Join(artifactDir, "seg%03d.ts"), filepath.Join(artifactDir, "master.m3u8"))
	}
}
