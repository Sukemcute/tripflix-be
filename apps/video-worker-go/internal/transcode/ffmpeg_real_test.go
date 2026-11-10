package transcode_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/storage"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/transcode"
)

// Chạy FFmpeg thật trên video tự tạo. CI không cài FFmpeg nên bỏ qua; chạy -short cũng bỏ qua.
func requireFFmpeg(t *testing.T) {
	t.Helper()
	if testing.Short() {
		t.Skip("bỏ qua FFmpeg thật khi chạy -short")
	}
	for _, name := range []string{"ffmpeg", "ffprobe"} {
		if _, err := exec.LookPath(name); err != nil {
			t.Skipf("không có %s", name)
		}
	}
}

func runTool(t *testing.T, name string, args ...string) string {
	t.Helper()
	output, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		t.Fatalf("%s %s: %v\n%s", name, strings.Join(args, " "), err, output)
	}
	return string(output)
}

type probedStream struct {
	CodecType    string `json:"codec_type"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	AvgFrameRate string `json:"avg_frame_rate"`
}

func probeStreams(t *testing.T, path string) []probedStream {
	t.Helper()
	var output struct {
		Streams []probedStream `json:"streams"`
	}
	raw := runTool(t, "ffprobe", "-v", "error", "-show_streams", "-of", "json", path)
	if err := json.Unmarshal([]byte(raw), &output); err != nil {
		t.Fatal(err)
	}
	return output.Streams
}

// transcodeReal chuyển mã file nguồn, ghi mọi object ra outDir để ffprobe đọc lại.
func transcodeReal(t *testing.T, sourcePath string) (string, []transcode.Rendition) {
	t.Helper()
	objectStorage := storage.NewMemoryStorage("dev/test/")
	source, err := os.Open(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	if err := objectStorage.PutObject(context.Background(), storage.PutObjectInput{Key: sourceKey, Body: source, ContentType: "video/mp4"}); err != nil {
		t.Fatal(err)
	}
	var renditions []transcode.Rendition
	job := transcode.Job{
		Storage: objectStorage, Transcoder: transcode.FFmpeg{}, TempDir: t.TempDir(),
		Publish: func(_ context.Context, r transcode.Rendition) error { renditions = append(renditions, r); return nil },
	}
	if err := job.Run(context.Background(), request); err != nil {
		t.Fatal(err)
	}

	outDir := t.TempDir()
	names := []string{"master.m3u8", "poster_360.jpg", "poster_540.jpg", "poster_720.jpg"}
	for _, r := range renditions {
		level := fmt.Sprintf("%dp", r.Level)
		names = append(names, level+"/index.m3u8")
		playlist, ok := objectStorage.Object(prefix + "/" + level + "/index.m3u8")
		if !ok {
			t.Fatalf("thiếu playlist %s", level)
		}
		for _, line := range strings.Split(string(playlist.Body), "\n") {
			if strings.HasSuffix(line, ".ts") {
				names = append(names, level+"/"+line)
			}
		}
	}
	for _, name := range names {
		object, ok := objectStorage.Object(prefix + "/" + name)
		if !ok {
			t.Fatalf("thiếu %s", name)
		}
		path := filepath.Join(outDir, name)
		_ = os.MkdirAll(filepath.Dir(path), 0o755)
		if err := os.WriteFile(path, object.Body, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return outDir, renditions
}

func TestFFmpegThatVideoDocCoTieng(t *testing.T) {
	requireFFmpeg(t)
	source := filepath.Join(t.TempDir(), "source.mp4")
	runTool(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=540x960:rate=30:duration=5.3",
		"-f", "lavfi", "-i", "sine=frequency=440:duration=5.3", "-c:v", "libx264", "-c:a", "aac",
		"-metadata", "location=+10.7769+106.7009/", "-shortest", source)

	outDir, renditions := transcodeReal(t, source)
	var levels []int
	for _, r := range renditions {
		levels = append(levels, r.Level)
	}
	if !slices.Equal(levels, []int{360, 540}) || renditions[0].Aspect != "9:16" || renditions[0].DurationSec != 6 {
		t.Fatalf("được %+v", renditions)
	}
	streams := probeStreams(t, filepath.Join(outDir, "540p/index.m3u8"))
	if len(streams) != 2 || streams[0].Width != 540 || streams[0].Height != 960 {
		t.Errorf("540p: %+v", streams)
	}
	// Giải mã hết 360p để chắc các đoạn đầy đủ.
	runTool(t, "ffmpeg", "-v", "error", "-i", filepath.Join(outDir, "360p/index.m3u8"), "-f", "null", "-")
	// Không còn vị trí GPS của file gốc.
	if tags := runTool(t, "ffprobe", "-v", "error", "-show_entries", "format_tags", "-of", "json", filepath.Join(outDir, "360p/seg_000.ts")); strings.Contains(tags, "106.7009") {
		t.Errorf("còn metadata vị trí: %s", tags)
	}
	poster := probeStreams(t, filepath.Join(outDir, "poster_540.jpg"))
	if poster[0].Width != 540 || poster[0].Height != 960 {
		t.Errorf("ảnh bìa: %+v", poster)
	}
}

func TestFFmpegThatVideoXoay90Do60fpsKhongTieng(t *testing.T) {
	requireFFmpeg(t)
	dir := t.TempDir()
	raw, source := filepath.Join(dir, "raw.mp4"), filepath.Join(dir, "source.mp4")
	runTool(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=60:duration=4", "-c:v", "libx264", raw)
	// Giống điện thoại quay dọc: lưu khung ngang kèm thông tin xoay 90 độ.
	runTool(t, "ffmpeg", "-v", "error", "-display_rotation", "90", "-i", raw, "-c", "copy", source)

	outDir, renditions := transcodeReal(t, source)
	if len(renditions) != 3 || renditions[0].Aspect != "9:16" {
		t.Fatalf("được %+v", renditions)
	}
	for level, want := range map[string][2]int{"360p": {360, 640}, "540p": {540, 960}, "720p": {720, 1280}} {
		streams := probeStreams(t, filepath.Join(outDir, level, "index.m3u8"))
		if len(streams) != 1 || streams[0].Width != want[0] || streams[0].Height != want[1] || streams[0].AvgFrameRate != "30/1" {
			t.Errorf("%s: %+v", level, streams)
		}
	}
	master, _ := os.ReadFile(filepath.Join(outDir, "master.m3u8"))
	if !strings.Contains(string(master), `RESOLUTION=720x1280,CODECS="avc1.4d401f"`) {
		t.Errorf("master:\n%s", master)
	}
}
