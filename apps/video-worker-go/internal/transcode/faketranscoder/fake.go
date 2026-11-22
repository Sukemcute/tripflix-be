// Package faketranscoder ghi file giả thay cho FFmpeg, dùng cho test vì CI không cài FFmpeg.
package faketranscoder

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/transcode"
)

type Fake struct {
	Video    transcode.VideoMetadata
	Playlist string
	// BeforeEncode, nếu có, chạy trước khi ghi file của mỗi mức; trả lỗi thì mức đó lỗi.
	BeforeEncode func(ctx context.Context, input transcode.EncodeLevelInput) error

	mu            sync.Mutex
	failOnLevels  map[int]bool
	encodedLevels []int
	posterWidths  []int
}

func New() *Fake {
	return &Fake{
		Video:        transcode.VideoMetadata{DisplayWidth: 1080, DisplayHeight: 1920, DurationSeconds: 42.5, HasAudio: true},
		Playlist:     "#EXTM3U\n#EXTINF:2.0,\nseg_000.ts\n#EXTINF:1.0,\nseg_001.ts\n#EXT-X-ENDLIST\n",
		failOnLevels: map[int]bool{},
	}
}

func (f *Fake) FailOn(level int, fail bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.failOnLevels[level] = fail
}

func (f *Fake) EncodedLevels() []int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]int(nil), f.encodedLevels...)
}

func (f *Fake) PosterWidths() []int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]int(nil), f.posterWidths...)
}

func (f *Fake) Reset() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.encodedLevels, f.posterWidths = nil, nil
}

func (f *Fake) Probe(context.Context, string) (transcode.VideoMetadata, error) {
	return f.Video, nil
}

func (f *Fake) EncodeLevel(ctx context.Context, input transcode.EncodeLevelInput) error {
	if f.BeforeEncode != nil {
		if err := f.BeforeEncode(ctx, input); err != nil {
			return err
		}
	}
	f.mu.Lock()
	fail := f.failOnLevels[input.Rung.Level]
	if !fail {
		f.encodedLevels = append(f.encodedLevels, input.Rung.Level)
	}
	f.mu.Unlock()
	if fail {
		return fmt.Errorf("FFmpeg lỗi giả ở %dp", input.Rung.Level)
	}
	files := map[string]string{"seg_000.ts": "segment-0", "seg_001.ts": "segment-1", "index.m3u8": f.Playlist}
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(input.OutputDir, name), []byte(body), 0o644); err != nil {
			return err
		}
	}
	return nil
}

func (f *Fake) CreatePoster(_ context.Context, input transcode.CreatePosterInput) error {
	f.mu.Lock()
	f.posterWidths = append(f.posterWidths, input.Width)
	f.mu.Unlock()
	return os.WriteFile(input.OutputPath, fmt.Appendf(nil, "poster-%d", input.Width), 0o644)
}
