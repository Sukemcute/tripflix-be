// Package transcode chuyển một video gốc thành HLS nhiều mức chất lượng. Thông số giữ đúng như bản TypeScript
// (apps/video-worker), để core-api và app không phải đổi gì.
package transcode

import "math"

// QualityRung là một mức chất lượng: Level là cạnh ngắn tính bằng pixel (360, 540, 720).
type QualityRung struct {
	Level     int
	VideoKbps int
}

// Thông số lấy từ lab/stream-lab/transcode.sh. Xếp từ thấp lên cao, vì làm mức thấp trước để đăng sớm.
var QualityRungs = []QualityRung{
	{Level: 360, VideoKbps: 365},
	{Level: 540, VideoKbps: 1100},
	{Level: 720, VideoKbps: 2000},
}

const (
	AudioKbps      = 96
	SegmentSeconds = 2
	MinTailSeconds = 0.5
	MaxFrameRate   = 30
)

var PosterWidths = []int{360, 540, 720}

// VideoMetadata là kích thước khi hiển thị, đã tính thông tin xoay của video quay từ điện thoại.
type VideoMetadata struct {
	DisplayWidth    int
	DisplayHeight   int
	DurationSeconds float64
	HasAudio        bool
}

// SelectRungs không phóng to quá video gốc, nhưng luôn có 360p để video nhỏ vẫn phát được.
func SelectRungs(video VideoMetadata) []QualityRung {
	shortEdge := min(video.DisplayWidth, video.DisplayHeight)
	var rungs []QualityRung
	for _, rung := range QualityRungs {
		if rung.Level <= shortEdge {
			rungs = append(rungs, rung)
		}
	}
	if len(rungs) == 0 {
		return QualityRungs[:1:1]
	}
	return rungs
}

// OutputSize tính mức chất lượng theo cạnh ngắn. H.264 yêu cầu kích thước chẵn.
func OutputSize(video VideoMetadata, level int) (width, height int) {
	w, h := float64(video.DisplayWidth), float64(video.DisplayHeight)
	if h > w {
		return level, roundToEven(h * float64(level) / w)
	}
	return roundToEven(w * float64(level) / h), level
}

func roundToEven(value float64) int {
	return int(math.Round(value/2)) * 2
}

// ClassifyAspect: cột aspect chỉ nhận 3 giá trị. Video từ 4:5 tới 5:4 tính là vuông, nên 3:4 tính là dọc và 4:3 là ngang.
func ClassifyAspect(video VideoMetadata) string {
	ratio := float64(video.DisplayWidth) / float64(video.DisplayHeight)
	switch {
	case ratio < 4.0/5:
		return "9:16"
	case ratio > 5.0/4:
		return "16:9"
	default:
		return "1:1"
	}
}

// RoundUpDurationSeconds: cột duration_sec là số nguyên, làm tròn lên giống lúc nhận thời lượng từ app.
func RoundUpDurationSeconds(durationSeconds float64) int {
	return max(1, int(math.Ceil(durationSeconds)))
}

// LastKeyframeSeconds: không đặt keyframe trong giây cuối, để đoạn cuối không quá ngắn làm trình phát đứng.
func LastKeyframeSeconds(durationSeconds float64) float64 {
	return max(0, durationSeconds-1)
}

// PosterSeconds: giây đầu thường đen, nhưng video ngắn thì lấy giữa video.
func PosterSeconds(durationSeconds float64) float64 {
	return min(1, durationSeconds/2)
}

// peakKbps là maxrate của video: 110% bitrate, làm tròn lên như Math.ceil của bản TypeScript.
func peakKbps(videoKbps int) int {
	return int(math.Ceil(float64(videoKbps) * 1.1))
}
