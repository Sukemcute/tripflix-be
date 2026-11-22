package transcode

import (
	"slices"
	"testing"
)

func video(width, height int) VideoMetadata {
	return VideoMetadata{DisplayWidth: width, DisplayHeight: height, DurationSeconds: 10, HasAudio: true}
}

func levels(rungs []QualityRung) []int {
	var out []int
	for _, rung := range rungs {
		out = append(out, rung.Level)
	}
	return out
}

func TestSelectRungsTheoCanhNgan(t *testing.T) {
	cases := []struct {
		width, height int
		want          []int
	}{
		{1080, 1920, []int{360, 540, 720}},
		{720, 1280, []int{360, 540, 720}},
		{540, 960, []int{360, 540}},
		{1920, 1080, []int{360, 540, 720}},
		{360, 640, []int{360}},
		// Video nhỏ hơn 360p vẫn có mức 360 để phát được.
		{240, 426, []int{360}},
	}
	for _, c := range cases {
		if got := levels(SelectRungs(video(c.width, c.height))); !slices.Equal(got, c.want) {
			t.Errorf("%dx%d: được %v, cần %v", c.width, c.height, got, c.want)
		}
	}
}

func TestSelectRungsKhongSuaDanhSachGoc(t *testing.T) {
	rungs := SelectRungs(video(240, 426))
	_ = append(rungs, QualityRung{Level: 999})
	if QualityRungs[1].Level != 540 {
		t.Fatal("append vào kết quả làm đổi QualityRungs")
	}
}

func TestOutputSize(t *testing.T) {
	cases := []struct {
		video               VideoMetadata
		level, wantW, wantH int
	}{
		// Video dọc lấy chiều rộng theo mức, video ngang lấy chiều cao theo mức.
		{video(1080, 1920), 360, 360, 640},
		{video(1080, 1920), 720, 720, 1280},
		{video(1920, 1080), 540, 960, 540},
	}
	for _, c := range cases {
		if w, h := OutputSize(c.video, c.level); w != c.wantW || h != c.wantH {
			t.Errorf("%+v ở %d: được %dx%d, cần %dx%d", c.video, c.level, w, h, c.wantW, c.wantH)
		}
	}
	if _, h := OutputSize(video(1081, 1921), 360); h%2 != 0 {
		t.Errorf("chiều cao %d không chẵn", h)
	}
}

func TestClassifyAspect(t *testing.T) {
	cases := []struct {
		width, height int
		want          string
	}{
		{1080, 1920, "9:16"},
		{1920, 1080, "16:9"},
		{1000, 1000, "1:1"},
		{1080, 1440, "9:16"},
		{1440, 1080, "16:9"},
		{1000, 1100, "1:1"},
	}
	for _, c := range cases {
		if got := ClassifyAspect(video(c.width, c.height)); got != c.want {
			t.Errorf("%dx%d: được %s, cần %s", c.width, c.height, got, c.want)
		}
	}
}

func TestTinhThoiGian(t *testing.T) {
	if got := RoundUpDurationSeconds(42.1); got != 43 {
		t.Errorf("làm tròn 42.1 được %d", got)
	}
	if got := RoundUpDurationSeconds(0.2); got != 1 {
		t.Errorf("tối thiểu 1 giây, được %d", got)
	}
	if got := LastKeyframeSeconds(10); got != 9 {
		t.Errorf("keyframe cuối của video 10 giây: %v", got)
	}
	if got := LastKeyframeSeconds(0.5); got != 0 {
		t.Errorf("keyframe cuối của video 0,5 giây: %v", got)
	}
	if got := PosterSeconds(10); got != 1 {
		t.Errorf("ảnh bìa của video 10 giây: %v", got)
	}
	if got := PosterSeconds(1); got != 0.5 {
		t.Errorf("ảnh bìa của video 1 giây: %v", got)
	}
}

// Bản TypeScript (Math.ceil(kbps * 1.1)) ra 402, 1210, 2200: giữ đúng để master và tham số FFmpeg không đổi.
func TestPeakKbpsGiongBanTypeScript(t *testing.T) {
	want := map[int]int{365: 402, 1100: 1210, 2000: 2200}
	for kbps, peak := range want {
		if got := peakKbps(kbps); got != peak {
			t.Errorf("peakKbps(%d) = %d, cần %d", kbps, got, peak)
		}
	}
}
