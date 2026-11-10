package transcode

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type EncodeLevelInput struct {
	SourcePath string
	OutputDir  string
	Rung       QualityRung
	Video      VideoMetadata
}

type CreatePosterInput struct {
	SourcePath string
	OutputPath string
	Width      int
	Video      VideoMetadata
}

// Transcoder tách khỏi FFmpeg để test xử lý việc chạy được trên CI, nơi không cài FFmpeg.
type Transcoder interface {
	Probe(ctx context.Context, sourcePath string) (VideoMetadata, error)
	// EncodeLevel ghi index.m3u8 và các đoạn seg_###.ts vào OutputDir.
	EncodeLevel(ctx context.Context, input EncodeLevelInput) error
	CreatePoster(ctx context.Context, input CreatePosterInput) error
}

// probeNumber nhận cả số lẫn chuỗi số, vì ffprobe ghi duration và tags.rotate dưới dạng chuỗi.
type probeNumber struct {
	Value float64
	Valid bool
}

func (n *probeNumber) UnmarshalJSON(data []byte) error {
	text := strings.Trim(string(data), `"`)
	if text == "null" || text == "" {
		return nil
	}
	value, err := strconv.ParseFloat(text, 64)
	if err != nil {
		return fmt.Errorf("không phải số: %s", data)
	}
	n.Value, n.Valid = value, true
	return nil
}

type probeOutput struct {
	Format struct {
		Duration probeNumber `json:"duration"`
	} `json:"format"`
	Streams []struct {
		CodecType string `json:"codec_type"`
		Width     int    `json:"width"`
		Height    int    `json:"height"`
		Tags      struct {
			Rotate probeNumber `json:"rotate"`
		} `json:"tags"`
		SideDataList []struct {
			Rotation probeNumber `json:"rotation"`
		} `json:"side_data_list"`
	} `json:"streams"`
}

// ParseProbeOutput đọc kết quả ffprobe. ffprobe báo kích thước trước khi xoay: điện thoại quay dọc thường lưu
// video ngang kèm thông tin xoay 90 độ.
func ParseProbeOutput(output []byte) (VideoMetadata, error) {
	var probe probeOutput
	if err := json.Unmarshal(output, &probe); err != nil {
		return VideoMetadata{}, fmt.Errorf("Không đọc được kết quả ffprobe: %w", err)
	}
	if !probe.Format.Duration.Valid || probe.Format.Duration.Value <= 0 {
		return VideoMetadata{}, errors.New("ffprobe không báo thời lượng video")
	}

	videoIndex, hasAudio := -1, false
	for i, stream := range probe.Streams {
		switch stream.CodecType {
		case "video":
			if videoIndex < 0 {
				videoIndex = i
			}
		case "audio":
			hasAudio = true
		}
	}
	if videoIndex < 0 || probe.Streams[videoIndex].Width <= 0 || probe.Streams[videoIndex].Height <= 0 {
		return VideoMetadata{}, errors.New("File không có luồng video")
	}
	stream := probe.Streams[videoIndex]

	rotation := 0.0
	if stream.Tags.Rotate.Valid {
		rotation = stream.Tags.Rotate.Value
	}
	for _, sideData := range stream.SideDataList {
		if sideData.Rotation.Valid {
			rotation = sideData.Rotation.Value
			break
		}
	}
	isSideways := math.Mod(math.Abs(rotation), 180) == 90
	width, height := stream.Width, stream.Height
	if isSideways {
		width, height = height, width
	}
	return VideoMetadata{
		DisplayWidth:    width,
		DisplayHeight:   height,
		DurationSeconds: probe.Format.Duration.Value,
		HasAudio:        hasAudio,
	}, nil
}

func formatSeconds(seconds float64) string {
	return strconv.FormatFloat(seconds, 'f', 2, 64)
}

func BuildEncodeArgs(input EncodeLevelInput) []string {
	level, videoKbps, video := input.Rung.Level, input.Rung.VideoKbps, input.Video
	scale := fmt.Sprintf("scale=-2:%d", level)
	if video.DisplayHeight > video.DisplayWidth {
		scale = fmt.Sprintf("scale=%d:-2", level)
	}
	args := []string{"-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", input.SourcePath, "-map", "0:v:0"}
	if video.HasAudio {
		args = append(args, "-map", "0:a:0")
	}
	args = append(args,
		// Bỏ metadata của file gốc, vì có thể chứa vị trí GPS mà file HLS thì công khai.
		"-map_metadata", "-1",
		"-vf", scale,
		"-fpsmax", strconv.Itoa(MaxFrameRate),
		"-c:v", "libx264",
		"-preset", "veryfast",
		"-profile:v", "main",
		"-pix_fmt", "yuv420p",
		"-sc_threshold", "0",
		// Các mức có keyframe cùng thời điểm thì trình phát đổi mức không bị giật.
		"-force_key_frames", fmt.Sprintf("expr:gte(t,n_forced*%d)*lt(t,%s)", SegmentSeconds, formatSeconds(LastKeyframeSeconds(video.DurationSeconds))),
		"-b:v", fmt.Sprintf("%dk", videoKbps),
		"-maxrate", fmt.Sprintf("%dk", peakKbps(videoKbps)),
		"-bufsize", fmt.Sprintf("%dk", videoKbps*2),
	)
	if video.HasAudio {
		args = append(args, "-c:a", "aac", "-b:a", fmt.Sprintf("%dk", AudioKbps), "-ac", "2")
	}
	return append(args,
		"-f", "hls",
		"-hls_time", strconv.Itoa(SegmentSeconds),
		"-hls_playlist_type", "vod",
		"-hls_flags", "independent_segments",
		"-hls_segment_filename", filepath.Join(input.OutputDir, "seg_%03d.ts"),
		filepath.Join(input.OutputDir, "index.m3u8"),
	)
}

func BuildPosterArgs(input CreatePosterInput) []string {
	return []string{
		"-nostdin", "-hide_banner", "-loglevel", "error", "-y",
		"-ss", formatSeconds(PosterSeconds(input.Video.DurationSeconds)),
		"-i", input.SourcePath,
		"-map_metadata", "-1",
		"-frames:v", "1",
		"-vf", fmt.Sprintf("scale=%d:-2", input.Width),
		"-q:v", "4",
		input.OutputPath,
	}
}

const (
	maxCapturedOutputBytes = 1_000_000
	// Chỉ giữ phần cuối stderr, nơi FFmpeg ghi lỗi.
	maxCapturedErrorBytes = 2_000
)

// limitedBuffer giữ tối đa limit byte đầu (keepTail = false) hoặc cuối (keepTail = true).
type limitedBuffer struct {
	buf      bytes.Buffer
	limit    int
	keepTail bool
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if !b.keepTail {
		if room := b.limit - b.buf.Len(); room > 0 {
			b.buf.Write(p[:min(len(p), room)])
		}
		return len(p), nil
	}
	b.buf.Write(p)
	if extra := b.buf.Len() - b.limit; extra > 0 {
		b.buf.Next(extra)
	}
	return len(p), nil
}

// runCommand chạy lệnh ngoài với mảng tham số, không qua shell, nên đường dẫn không bị diễn giải thành lệnh.
// Huỷ ctx thì tiến trình bị dừng ngay.
func runCommand(ctx context.Context, name string, args []string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	stdout := &limitedBuffer{limit: maxCapturedOutputBytes}
	stderr := &limitedBuffer{limit: maxCapturedErrorBytes, keepTail: true}
	cmd.Stdout, cmd.Stderr = stdout, stderr
	// Tiến trình con giữ ống stdout sau khi bị dừng thì không đợi mãi.
	cmd.WaitDelay = 5 * time.Second
	if err := cmd.Run(); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, fmt.Errorf("%s bị dừng: %w", name, ctxErr)
		}
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return nil, fmt.Errorf("%s thoát mã %d: %s", name, exitErr.ExitCode(), strings.TrimSpace(stderr.buf.String()))
		}
		return nil, fmt.Errorf("không chạy được %s: %w", name, err)
	}
	return stdout.buf.Bytes(), nil
}

// FFmpeg gọi lệnh ffprobe, ffmpeg có trong PATH.
type FFmpeg struct{}

func (FFmpeg) Probe(ctx context.Context, sourcePath string) (VideoMetadata, error) {
	output, err := runCommand(ctx, "ffprobe", []string{"-v", "error", "-show_format", "-show_streams", "-of", "json", sourcePath})
	if err != nil {
		return VideoMetadata{}, err
	}
	return ParseProbeOutput(output)
}

func (FFmpeg) EncodeLevel(ctx context.Context, input EncodeLevelInput) error {
	_, err := runCommand(ctx, "ffmpeg", BuildEncodeArgs(input))
	return err
}

func (FFmpeg) CreatePoster(ctx context.Context, input CreatePosterInput) error {
	_, err := runCommand(ctx, "ffmpeg", BuildPosterArgs(input))
	return err
}
