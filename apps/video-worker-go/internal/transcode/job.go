package transcode

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"golang.org/x/sync/errgroup"

	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/storage"
)

const (
	// Tên file có số phiên bản r{n} và không đổi, nên cache lâu. Riêng master bị ghi lại khi xong thêm mức.
	immutableCacheControl = "public, max-age=31536000, immutable"
	masterCacheControl    = "public, max-age=60"
	playlistContentType   = "application/vnd.apple.mpegurl"
	uploadConcurrency     = 4
)

// Request là payload của content.media.transcode_requested v1.
type Request struct {
	AssetID   string
	SourceKey string
	Revision  int
}

// Rendition là payload của media.rendition.completed v1.
type Rendition struct {
	AssetID     string `json:"assetId"`
	Level       int    `json:"level"`
	HLSPrefix   string `json:"hlsPrefix"`
	DurationSec int    `json:"durationSec"`
	Aspect      string `json:"aspect"`
}

// LevelError cho biết lỗi ở mức chất lượng nào, để bên nhận biết còn phát được video hay không.
type LevelError struct {
	Level int
	Err   error
}

func (e *LevelError) Error() string { return e.Err.Error() }
func (e *LevelError) Unwrap() error { return e.Err }

// RenditionPublisher phát media.rendition.completed.
type RenditionPublisher func(ctx context.Context, rendition Rendition) error

// Job chuyển mã một video, làm từng mức từ thấp lên cao. Mỗi mức xong thì ghi lại master rồi mới báo.
// Redis có thể giao lại việc: mức đã có index.m3u8 thì không làm lại, chỉ báo lại, vì lần trước
// có thể đã chết trước khi báo. index.m3u8 được ghi sau cùng nên có nó nghĩa là đủ các đoạn.
type Job struct {
	Storage    storage.ObjectStorage
	Transcoder Transcoder
	Publish    RenditionPublisher
	// TempDir là nơi tạo thư mục tạm; để trống thì dùng thư mục tạm của hệ thống.
	TempDir string
}

func (j *Job) Run(ctx context.Context, request Request) error {
	// Chưa làm tới mức nào thì tính là lỗi ở mức thấp nhất, vì lúc đó video chưa phát được.
	currentLevel := QualityRungs[0].Level
	if err := j.run(ctx, request, &currentLevel); err != nil {
		return &LevelError{Level: currentLevel, Err: err}
	}
	return nil
}

func (j *Job) run(ctx context.Context, request Request, currentLevel *int) error {
	workDir, err := os.MkdirTemp(j.TempDir, "video-worker-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(workDir)

	sourcePath := filepath.Join(workDir, "source")
	if err := j.downloadSource(ctx, request.SourceKey, sourcePath); err != nil {
		return err
	}
	video, err := j.Transcoder.Probe(ctx, sourcePath)
	if err != nil {
		return err
	}
	hlsPrefix := j.Storage.ResolveKey(fmt.Sprintf("videos/%s/r%d", request.AssetID, request.Revision))
	rungs := SelectRungs(video)
	rendition := Rendition{
		AssetID:     request.AssetID,
		HLSPrefix:   hlsPrefix,
		DurationSec: RoundUpDurationSeconds(video.DurationSeconds),
		Aspect:      ClassifyAspect(video),
	}
	publish := func(level int) error {
		r := rendition
		r.Level = level
		return j.Publish(ctx, r)
	}

	var doneRungs, pendingRungs []QualityRung
	for _, rung := range rungs {
		done, err := j.Storage.HasObject(ctx, levelPlaylistKey(hlsPrefix, rung))
		if err != nil {
			return err
		}
		if done {
			doneRungs = append(doneRungs, rung)
		} else {
			pendingRungs = append(pendingRungs, rung)
		}
	}
	if len(doneRungs) > 0 {
		if err := j.uploadMaster(ctx, hlsPrefix, doneRungs, video); err != nil {
			return err
		}
	}
	for _, rung := range doneRungs {
		if err := publish(rung.Level); err != nil {
			return err
		}
	}

	for _, rung := range pendingRungs {
		*currentLevel = rung.Level
		// Ảnh bìa phải có trước khi video được đăng, tức trước khi báo xong mức đầu tiên.
		if len(doneRungs) == 0 {
			if err := j.createPosters(ctx, sourcePath, workDir, hlsPrefix, video); err != nil {
				return err
			}
		}
		if err := j.encodeAndUploadLevel(ctx, sourcePath, workDir, hlsPrefix, rung, video); err != nil {
			return err
		}
		doneRungs = append(doneRungs, rung)
		if err := j.uploadMaster(ctx, hlsPrefix, doneRungs, video); err != nil {
			return err
		}
		if err := publish(rung.Level); err != nil {
			return err
		}
	}
	return nil
}

func levelPlaylistKey(hlsPrefix string, rung QualityRung) string {
	return fmt.Sprintf("%s/%dp/index.m3u8", hlsPrefix, rung.Level)
}

// downloadSource ghi thẳng ra đĩa, không giữ cả file gốc trong RAM.
func (j *Job) downloadSource(ctx context.Context, sourceKey, targetPath string) error {
	body, err := j.Storage.GetObject(ctx, sourceKey)
	if err != nil {
		return err
	}
	defer body.Close()
	file, err := os.Create(targetPath)
	if err != nil {
		return err
	}
	if _, err := io.Copy(file, body); err != nil {
		file.Close()
		return err
	}
	return file.Close()
}

func (j *Job) putFile(ctx context.Context, key, path, contentType, cacheControl string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	return j.Storage.PutObject(ctx, storage.PutObjectInput{Key: key, Body: file, ContentType: contentType, CacheControl: cacheControl})
}

func (j *Job) createPosters(ctx context.Context, sourcePath, workDir, hlsPrefix string, video VideoMetadata) error {
	for _, width := range PosterWidths {
		fileName := fmt.Sprintf("poster_%d.jpg", width)
		outputPath := filepath.Join(workDir, fileName)
		if err := j.Transcoder.CreatePoster(ctx, CreatePosterInput{SourcePath: sourcePath, OutputPath: outputPath, Width: width, Video: video}); err != nil {
			return err
		}
		if err := j.putFile(ctx, hlsPrefix+"/"+fileName, outputPath, "image/jpeg", immutableCacheControl); err != nil {
			return err
		}
	}
	return nil
}

func (j *Job) encodeAndUploadLevel(ctx context.Context, sourcePath, workDir, hlsPrefix string, rung QualityRung, video VideoMetadata) error {
	outputDir := filepath.Join(workDir, fmt.Sprintf("%dp", rung.Level))
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return err
	}
	defer os.RemoveAll(outputDir)
	if err := j.Transcoder.EncodeLevel(ctx, EncodeLevelInput{SourcePath: sourcePath, OutputDir: outputDir, Rung: rung, Video: video}); err != nil {
		return err
	}

	playlistPath := filepath.Join(outputDir, "index.m3u8")
	levelPlaylist, err := os.ReadFile(playlistPath)
	if err != nil {
		return err
	}
	if err := AssertTailLongEnough(string(levelPlaylist)); err != nil {
		return err
	}

	entries, err := os.ReadDir(outputDir)
	if err != nil {
		return err
	}
	var segmentNames []string
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".ts") {
			segmentNames = append(segmentNames, entry.Name())
		}
	}
	slices.Sort(segmentNames)

	group, groupCtx := errgroup.WithContext(ctx)
	group.SetLimit(uploadConcurrency)
	for _, name := range segmentNames {
		group.Go(func() error {
			key := fmt.Sprintf("%s/%dp/%s", hlsPrefix, rung.Level, name)
			return j.putFile(groupCtx, key, filepath.Join(outputDir, name), "video/mp2t", immutableCacheControl)
		})
	}
	if err := group.Wait(); err != nil {
		return err
	}
	// Ghi sau cùng: có index.m3u8 nghĩa là đủ các đoạn.
	return j.putFile(ctx, levelPlaylistKey(hlsPrefix, rung), playlistPath, playlistContentType, immutableCacheControl)
}

func (j *Job) uploadMaster(ctx context.Context, hlsPrefix string, rungs []QualityRung, video VideoMetadata) error {
	return j.Storage.PutObject(ctx, storage.PutObjectInput{
		Key:          hlsPrefix + "/master.m3u8",
		Body:         strings.NewReader(BuildMasterPlaylist(rungs, video)),
		ContentType:  playlistContentType,
		CacheControl: masterCacheControl,
	})
}
