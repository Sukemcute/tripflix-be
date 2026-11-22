package transcode

import (
	"cmp"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

const (
	// main profile, level 3.1: đủ cho 720p ở tối đa 30 khung hình mỗi giây.
	videoCodec = "avc1.4d401f"
	audioCodec = "mp4a.40.2"
)

// BuildMasterPlaylist: worker ghi lại master mỗi khi xong thêm một mức, nên chỉ liệt kê các mức đã có trên S3.
// Xếp mức cao nhất lên đầu: trình phát iOS bắt đầu từ mức đầu tiên rồi mới đo mạng, mà reels ngắn
// thường hết trước khi kịp lên mức cao. Mạng yếu thì trình phát tự hạ xuống.
func BuildMasterPlaylist(rungs []QualityRung, video VideoMetadata) string {
	codecs := videoCodec
	if video.HasAudio {
		codecs = videoCodec + "," + audioCodec
	}
	var b strings.Builder
	b.WriteString("#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-INDEPENDENT-SEGMENTS\n")
	ordered := slices.Clone(rungs)
	slices.SortFunc(ordered, func(a, b QualityRung) int { return cmp.Compare(b.Level, a.Level) })
	for _, rung := range ordered {
		width, height := OutputSize(video, rung.Level)
		// BANDWIDTH phải là mức đỉnh: maxrate của video cộng âm thanh.
		peak := peakKbps(rung.VideoKbps)
		if video.HasAudio {
			peak += AudioKbps
		}
		fmt.Fprintf(&b, "#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=%dx%d,CODECS=\"%s\"\n", peak*1000, width, height, codecs)
		fmt.Fprintf(&b, "%dp/index.m3u8\n", rung.Level)
	}
	return b.String()
}

var extinfPattern = regexp.MustCompile(`(?m)^#EXTINF:([\d.]+),`)

// AssertTailLongEnough: đoạn cuối quá ngắn làm trình phát đứng. Video chỉ có một đoạn thì không có đoạn nào để gộp, nên bỏ qua.
func AssertTailLongEnough(levelPlaylist string) error {
	matches := extinfPattern.FindAllStringSubmatch(levelPlaylist, -1)
	if len(matches) == 0 {
		return errors.New("Playlist không có đoạn video nào")
	}
	tail := matches[len(matches)-1][1]
	tailSeconds, err := strconv.ParseFloat(tail, 64)
	if err != nil {
		return fmt.Errorf("Không đọc được thời lượng đoạn cuối %q", tail)
	}
	if len(matches) > 1 && tailSeconds < MinTailSeconds {
		return fmt.Errorf("Đoạn cuối chỉ dài %s giây", strconv.FormatFloat(tailSeconds, 'f', -1, 64))
	}
	return nil
}
