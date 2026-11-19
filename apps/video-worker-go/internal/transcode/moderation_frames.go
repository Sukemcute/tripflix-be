package transcode

import (
	"context"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"

	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/events"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/storage"
)

type FrameError struct{ Code string }

func (e *FrameError) Error() string { return e.Code }
func SampleFrameTimes(durationMS int) ([]int, error) {
	if durationMS < 1 || durationMS > 300000 {
		return nil, &FrameError{Code: "video_too_long"}
	}
	last := max(0, durationMS-max(1, min(100, durationMS/2)))
	count := min(24, (last+4999)/5000+1)
	times := make([]int, count)
	if count > 1 {
		for i := range times {
			times[i] = int(math.Floor(float64(last*i)/float64(count-1) + 0.5))
		}
	}
	return times, nil
}
func BuildFrameArgs(source, output string, timestampMS int) []string {
	return []string{"-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-ss", fmt.Sprintf("%.3f", float64(timestampMS)/1000),
		"-i", source, "-map", "0:v:0", "-map_metadata", "-1", "-frames:v", "1", "-vf",
		"scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2", "-q:v", "4", output}
}

type FrameExtractor func(context.Context, string, string, int) error
type FramesJob struct {
	Storage    storage.ObjectStorage
	Transcoder Transcoder
	TempDir    string
	Extract    FrameExtractor
}

func (j *FramesJob) Run(ctx context.Context, r events.FramesRequested) (events.FramesCompleted, error) {
	result := events.FramesCompleted{AssetID: r.AssetID, RequestID: r.RequestID, HLSPrefix: r.HLSPrefix, Policy: r.Policy}
	dir, err := os.MkdirTemp(j.TempDir, "moderation-frames-")
	if err != nil {
		return result, err
	}
	defer os.RemoveAll(dir)
	body, err := j.Storage.GetObject(ctx, r.SourceKey)
	if err != nil {
		return result, err
	}
	defer body.Close()
	source := filepath.Join(dir, "source")
	file, err := os.Create(source)
	if err != nil {
		return result, err
	}
	size, copyErr := io.Copy(file, io.LimitReader(body, 1073741825))
	closeErr := file.Close()
	if copyErr != nil {
		return result, copyErr
	}
	if closeErr != nil {
		return result, closeErr
	}
	if size > 1073741824 {
		return result, &FrameError{Code: "source_too_large"}
	}
	video, err := j.Transcoder.Probe(ctx, source)
	if err != nil {
		return result, err
	}
	result.DurationMS = int(math.Round(video.DurationSeconds * 1000))
	times, err := SampleFrameTimes(result.DurationMS)
	if err != nil {
		return result, err
	}
	extract := j.Extract
	if extract == nil {
		extract = func(ctx context.Context, source, output string, ms int) error {
			_, err := runCommand(ctx, "ffmpeg", BuildFrameArgs(source, output, ms))
			return err
		}
	}
	for _, ms := range times {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		output := filepath.Join(dir, fmt.Sprintf("%d.jpg", ms))
		if err := extract(ctx, source, output, ms); err != nil {
			return result, err
		}
		info, err := os.Stat(output)
		if err != nil {
			return result, err
		}
		if info.Size() < 1 || info.Size() > 1048576 {
			return result, &FrameError{Code: "extraction_failed"}
		}
		key := fmt.Sprintf("%s/moderation/%s/%s/%d.jpg", r.HLSPrefix, r.Policy, r.RequestID, ms)
		frame, err := os.Open(output)
		if err != nil {
			return result, err
		}
		err = j.Storage.PutObject(ctx, storage.PutObjectInput{Key: key, Body: frame, ContentType: "image/jpeg", CacheControl: immutableCacheControl})
		frame.Close()
		if err != nil {
			return result, err
		}
		result.Frames = append(result.Frames, events.ModerationFrame{TimestampMS: ms, Key: key})
	}
	return result, nil
}
