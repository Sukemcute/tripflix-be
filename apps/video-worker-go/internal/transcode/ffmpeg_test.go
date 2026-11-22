package transcode

import (
	"encoding/json"
	"path/filepath"
	"slices"
	"testing"
)

func buildProbe(t *testing.T, stream map[string]any, otherStreams ...map[string]any) []byte {
	t.Helper()
	videoStream := map[string]any{"codec_type": "video", "width": 1920, "height": 1080}
	for key, value := range stream {
		videoStream[key] = value
	}
	body, err := json.Marshal(map[string]any{
		"format":  map[string]any{"duration": "12.5"},
		"streams": append([]map[string]any{videoStream}, otherStreams...),
	})
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func TestParseProbeOutputDocKichThuocThoiLuongAmThanh(t *testing.T) {
	got, err := ParseProbeOutput(buildProbe(t, nil, map[string]any{"codec_type": "audio"}))
	if err != nil {
		t.Fatal(err)
	}
	want := VideoMetadata{DisplayWidth: 1920, DisplayHeight: 1080, DurationSeconds: 12.5, HasAudio: true}
	if got != want {
		t.Errorf("được %+v", got)
	}
}

func TestParseProbeOutputVideoQuayDocThiDoiChieu(t *testing.T) {
	cases := map[string]map[string]any{
		"side_data rotation -90": {"side_data_list": []any{map[string]any{"rotation": -90}}},
		"side_data rotation 90":  {"side_data_list": []any{map[string]any{"rotation": 90}}},
		"side_data rotation 270": {"side_data_list": []any{map[string]any{"rotation": 270}}},
		"tags rotate 90":         {"tags": map[string]any{"rotate": "90"}},
		// side_data đầu tiên không có rotation thì đọc cái sau.
		"side_data thứ hai": {"side_data_list": []any{map[string]any{"side_data_type": "Display Matrix"}, map[string]any{"rotation": 90}}},
	}
	for name, stream := range cases {
		got, err := ParseProbeOutput(buildProbe(t, stream))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if got.DisplayWidth != 1080 || got.DisplayHeight != 1920 {
			t.Errorf("%s: được %dx%d", name, got.DisplayWidth, got.DisplayHeight)
		}
	}
}

func TestParseProbeOutputXoay180GiuNguyen(t *testing.T) {
	got, err := ParseProbeOutput(buildProbe(t, map[string]any{"side_data_list": []any{map[string]any{"rotation": 180}}}))
	if err != nil {
		t.Fatal(err)
	}
	if got.DisplayWidth != 1920 || got.DisplayHeight != 1080 {
		t.Errorf("được %dx%d", got.DisplayWidth, got.DisplayHeight)
	}
}

func TestParseProbeOutputLoi(t *testing.T) {
	got, err := ParseProbeOutput(buildProbe(t, nil))
	if err != nil || got.HasAudio {
		t.Errorf("thiếu luồng âm thanh phải báo không có tiếng: %+v, %v", got, err)
	}
	if _, err := ParseProbeOutput([]byte(`{"format":{"duration":"1"},"streams":[{"codec_type":"audio"}]}`)); err == nil || err.Error() != "File không có luồng video" {
		t.Errorf("không có luồng video phải báo lỗi, được %v", err)
	}
	if _, err := ParseProbeOutput([]byte(`{"format":{},"streams":[{"codec_type":"video","width":2,"height":2}]}`)); err == nil {
		t.Error("thiếu thời lượng phải báo lỗi")
	}
}

func readOption(args []string, name string) string {
	index := slices.Index(args, name)
	if index < 0 || index+1 >= len(args) {
		return ""
	}
	return args[index+1]
}

var encodeInput = EncodeLevelInput{
	SourcePath: "/tmp/source",
	OutputDir:  "/tmp/360p",
	Rung:       QualityRungs[0],
	Video:      VideoMetadata{DisplayWidth: 1080, DisplayHeight: 1920, DurationSeconds: 10, HasAudio: true},
}

func TestBuildEncodeArgsScaleTheoChieu(t *testing.T) {
	if got := readOption(BuildEncodeArgs(encodeInput), "-vf"); got != "scale=360:-2" {
		t.Errorf("video dọc: %s", got)
	}
	landscape := encodeInput
	landscape.Video.DisplayWidth, landscape.Video.DisplayHeight = 1920, 1080
	if got := readOption(BuildEncodeArgs(landscape), "-vf"); got != "scale=-2:360" {
		t.Errorf("video ngang: %s", got)
	}
}

func TestBuildEncodeArgsKeyframeVaBitrate(t *testing.T) {
	args := BuildEncodeArgs(encodeInput)
	want := map[string]string{
		"-force_key_frames": "expr:gte(t,n_forced*2)*lt(t,9.00)",
		"-b:v":              "365k",
		"-maxrate":          "402k",
		"-bufsize":          "730k",
		// Bỏ metadata của file gốc để không lộ vị trí GPS.
		"-map_metadata":         "-1",
		"-hls_segment_filename": filepath.Join(encodeInput.OutputDir, "seg_%03d.ts"),
	}
	for name, value := range want {
		if got := readOption(args, name); got != value {
			t.Errorf("%s = %q, cần %q", name, got, value)
		}
	}
	if last := args[len(args)-1]; last != filepath.Join(encodeInput.OutputDir, "index.m3u8") {
		t.Errorf("tham số cuối: %s", last)
	}
}

func TestBuildEncodeArgsKhongTieng(t *testing.T) {
	silent := encodeInput
	silent.Video.HasAudio = false
	args := BuildEncodeArgs(silent)
	if slices.Contains(args, "0:a:0") || slices.Contains(args, "-c:a") {
		t.Errorf("video không tiếng vẫn chọn âm thanh: %v", args)
	}
}

func TestBuildPosterArgs(t *testing.T) {
	args := BuildPosterArgs(CreatePosterInput{SourcePath: "/tmp/source", OutputPath: "/tmp/p.jpg", Width: 540, Video: encodeInput.Video})
	want := map[string]string{"-vf": "scale=540:-2", "-frames:v": "1", "-ss": "1.00"}
	for name, value := range want {
		if got := readOption(args, name); got != value {
			t.Errorf("%s = %q, cần %q", name, got, value)
		}
	}
	if last := args[len(args)-1]; last != "/tmp/p.jpg" {
		t.Errorf("tham số cuối: %s", last)
	}
}

func TestLimitedBufferGiuPhanCuoi(t *testing.T) {
	buffer := &limitedBuffer{limit: 5, keepTail: true}
	_, _ = buffer.Write([]byte("abc"))
	_, _ = buffer.Write([]byte("defgh"))
	if got := buffer.buf.String(); got != "defgh" {
		t.Errorf("được %q", got)
	}
	head := &limitedBuffer{limit: 5}
	_, _ = head.Write([]byte("abcdefgh"))
	if got := head.buf.String(); got != "abcde" {
		t.Errorf("được %q", got)
	}
}
