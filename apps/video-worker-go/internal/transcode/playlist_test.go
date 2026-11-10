package transcode

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"testing"
)

var portraitVideo = VideoMetadata{DisplayWidth: 1080, DisplayHeight: 1920, DurationSeconds: 10, HasAudio: true}

func TestBuildMasterPlaylistChiCoMucDaXong(t *testing.T) {
	want := strings.Join([]string{
		"#EXTM3U",
		"#EXT-X-VERSION:6",
		"#EXT-X-INDEPENDENT-SEGMENTS",
		`#EXT-X-STREAM-INF:BANDWIDTH=498000,RESOLUTION=360x640,CODECS="avc1.4d401f,mp4a.40.2"`,
		"360p/index.m3u8",
		"",
	}, "\n")
	if got := BuildMasterPlaylist(QualityRungs[:1], portraitVideo); got != want {
		t.Errorf("được\n%s\ncần\n%s", got, want)
	}
}

func TestBuildMasterPlaylistDuCacMucTheoThuTu(t *testing.T) {
	playlist := BuildMasterPlaylist(QualityRungs, portraitVideo)
	got := regexp.MustCompile(`(?m)^\d+p/index\.m3u8$`).FindAllString(playlist, -1)
	if want := []string{"360p/index.m3u8", "540p/index.m3u8", "720p/index.m3u8"}; !slices.Equal(got, want) {
		t.Errorf("được %v", got)
	}
	if !strings.Contains(playlist, "BANDWIDTH=1306000,RESOLUTION=540x960") {
		t.Errorf("BANDWIDTH 540p khác bản TypeScript:\n%s", playlist)
	}
}

// Trình phát có thể từ chối nếu khai codec âm thanh mà không có tiếng.
func TestBuildMasterPlaylistKhongTieng(t *testing.T) {
	silent := portraitVideo
	silent.HasAudio = false
	playlist := BuildMasterPlaylist(QualityRungs[:1], silent)
	for _, want := range []string{`CODECS="avc1.4d401f"`, "BANDWIDTH=402000"} {
		if !strings.Contains(playlist, want) {
			t.Errorf("thiếu %s trong\n%s", want, playlist)
		}
	}
}

func buildLevelPlaylist(seconds ...float64) string {
	var lines []string
	for _, s := range seconds {
		lines = append(lines, fmt.Sprintf("#EXTINF:%v,\nseg.ts", s))
	}
	return strings.Join(lines, "\n")
}

func TestAssertTailLongEnough(t *testing.T) {
	if err := AssertTailLongEnough(buildLevelPlaylist(2, 0.5)); err != nil {
		t.Errorf("đoạn cuối 0,5 giây phải được nhận: %v", err)
	}
	if err := AssertTailLongEnough(buildLevelPlaylist(2, 0.2)); err == nil || err.Error() != "Đoạn cuối chỉ dài 0.2 giây" {
		t.Errorf("đoạn cuối 0,2 giây phải bị từ chối, được %v", err)
	}
	if err := AssertTailLongEnough(buildLevelPlaylist(0.2)); err != nil {
		t.Errorf("video chỉ có một đoạn thì nhận dù ngắn: %v", err)
	}
	if err := AssertTailLongEnough("#EXTM3U"); err == nil || err.Error() != "Playlist không có đoạn video nào" {
		t.Errorf("playlist rỗng phải báo lỗi, được %v", err)
	}
}
