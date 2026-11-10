package transcode_test

import (
	"context"
	"errors"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/storage"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/transcode"
	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/transcode/faketranscoder"
)

const (
	assetID   = "11111111-1111-4111-8111-111111111111"
	sourceKey = "dev/test/uploads/" + assetID + "/original.mp4"
	prefix    = "dev/test/videos/" + assetID + "/r1"
)

var request = transcode.Request{AssetID: assetID, SourceKey: sourceKey, Revision: 1}

type setup struct {
	storage    *storage.MemoryStorage
	transcoder *faketranscoder.Fake
	renditions []transcode.Rendition
	job        *transcode.Job
	// onPublish chạy lúc báo mỗi mức, để kiểm trạng thái S3 ngay lúc đó.
	onPublish func(transcode.Rendition)
}

func newSetup(t *testing.T, transcoder *faketranscoder.Fake) *setup {
	t.Helper()
	s := &setup{storage: storage.NewMemoryStorage("dev/test/"), transcoder: transcoder}
	if err := s.storage.PutObject(context.Background(), storage.PutObjectInput{Key: sourceKey, Body: strings.NewReader("video"), ContentType: "video/mp4"}); err != nil {
		t.Fatal(err)
	}
	s.job = &transcode.Job{
		Storage:    s.storage,
		Transcoder: transcoder,
		TempDir:    t.TempDir(),
		Publish: func(_ context.Context, rendition transcode.Rendition) error {
			if s.onPublish != nil {
				s.onPublish(rendition)
			}
			s.renditions = append(s.renditions, rendition)
			return nil
		},
	}
	return s
}

func (s *setup) run() error { return s.job.Run(context.Background(), request) }

func (s *setup) levels() []int {
	var out []int
	for _, r := range s.renditions {
		out = append(out, r.Level)
	}
	return out
}

func (s *setup) object(t *testing.T, key string) storage.StoredObject {
	t.Helper()
	object, ok := s.storage.Object(key)
	if !ok {
		t.Fatalf("thiếu %s", key)
	}
	return object
}

func TestLamTungMucTuThapLenCaoVaBaoMoiMucMotLan(t *testing.T) {
	s := newSetup(t, faketranscoder.New())
	if err := s.run(); err != nil {
		t.Fatal(err)
	}
	if got := s.transcoder.EncodedLevels(); !slices.Equal(got, []int{360, 540, 720}) {
		t.Errorf("thứ tự chuyển mã: %v", got)
	}
	var want []transcode.Rendition
	for _, level := range []int{360, 540, 720} {
		want = append(want, transcode.Rendition{AssetID: assetID, Level: level, HLSPrefix: prefix, DurationSec: 43, Aspect: "9:16"})
	}
	if !slices.Equal(s.renditions, want) {
		t.Errorf("được %+v", s.renditions)
	}
}

func TestKhiBaoXong360pThiDaCoAnhBiaDoanVideoVaMasterChiCo360p(t *testing.T) {
	s := newSetup(t, faketranscoder.New())
	var masters []string
	s.onPublish = func(rendition transcode.Rendition) {
		masters = append(masters, string(s.object(t, prefix+"/master.m3u8").Body))
		if rendition.Level != 360 {
			return
		}
		for _, name := range []string{"poster_360.jpg", "poster_540.jpg", "poster_720.jpg", "360p/seg_000.ts"} {
			if _, ok := s.storage.Object(prefix + "/" + name); !ok {
				t.Errorf("báo xong 360p khi chưa có %s", name)
			}
		}
	}
	if err := s.run(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(masters[0], "360p/index.m3u8") || strings.Contains(masters[0], "540p/index.m3u8") {
		t.Errorf("master lúc báo 360p:\n%s", masters[0])
	}
	if !strings.Contains(masters[2], "720p/index.m3u8") {
		t.Errorf("master lúc báo 720p:\n%s", masters[2])
	}
}

func TestDatCacheVaLoaiFileDung(t *testing.T) {
	s := newSetup(t, faketranscoder.New())
	if err := s.run(); err != nil {
		t.Fatal(err)
	}
	const immutable = "public, max-age=31536000, immutable"
	cases := map[string][2]string{
		"master.m3u8":     {"application/vnd.apple.mpegurl", "public, max-age=60"},
		"360p/index.m3u8": {"application/vnd.apple.mpegurl", immutable},
		"360p/seg_000.ts": {"video/mp2t", immutable},
		"poster_540.jpg":  {"image/jpeg", immutable},
		"720p/seg_001.ts": {"video/mp2t", immutable},
		"720p/index.m3u8": {"application/vnd.apple.mpegurl", immutable},
		"poster_720.jpg":  {"image/jpeg", immutable},
		"540p/seg_000.ts": {"video/mp2t", immutable},
		"540p/index.m3u8": {"application/vnd.apple.mpegurl", immutable},
		"poster_360.jpg":  {"image/jpeg", immutable},
		"360p/seg_001.ts": {"video/mp2t", immutable},
		"540p/seg_001.ts": {"video/mp2t", immutable},
		"720p/seg_000.ts": {"video/mp2t", immutable},
	}
	for name, want := range cases {
		object := s.object(t, prefix+"/"+name)
		if object.ContentType != want[0] || object.CacheControl != want[1] {
			t.Errorf("%s: %s, %s", name, object.ContentType, object.CacheControl)
		}
	}
	if got := string(s.object(t, prefix+"/360p/seg_001.ts").Body); got != "segment-1" {
		t.Errorf("nội dung đoạn: %q", got)
	}
}

func TestVideoGocNhoThiKhongPhongTo(t *testing.T) {
	transcoder := faketranscoder.New()
	transcoder.Video = transcode.VideoMetadata{DisplayWidth: 540, DisplayHeight: 960, DurationSeconds: 5, HasAudio: true}
	s := newSetup(t, transcoder)
	if err := s.run(); err != nil {
		t.Fatal(err)
	}
	if got := s.levels(); !slices.Equal(got, []int{360, 540}) {
		t.Errorf("được %v", got)
	}
}

func TestGiaoLaiMucDaXongKhongLamLaiNhungVanBaoLai(t *testing.T) {
	transcoder := faketranscoder.New()
	transcoder.FailOn(540, true)
	s := newSetup(t, transcoder)
	var levelErr *transcode.LevelError
	if err := s.run(); !errors.As(err, &levelErr) {
		t.Fatalf("cần LevelError, được %v", err)
	}
	if got := s.levels(); !slices.Equal(got, []int{360}) {
		t.Fatalf("lần đầu báo %v", got)
	}

	transcoder.FailOn(540, false)
	transcoder.Reset()
	s.renditions = nil
	if err := s.run(); err != nil {
		t.Fatal(err)
	}
	if got := transcoder.EncodedLevels(); !slices.Equal(got, []int{540, 720}) {
		t.Errorf("lần hai chuyển mã %v", got)
	}
	if got := transcoder.PosterWidths(); len(got) != 0 {
		t.Errorf("lần hai làm lại ảnh bìa %v", got)
	}
	if got := s.levels(); !slices.Equal(got, []int{360, 540, 720}) {
		t.Errorf("lần hai báo %v", got)
	}
	if !strings.Contains(string(s.object(t, prefix+"/master.m3u8").Body), "720p/index.m3u8") {
		t.Error("master thiếu 720p")
	}
}

func TestGiaoLaiKhiDaXongHetKhongChuyenMaLai(t *testing.T) {
	s := newSetup(t, faketranscoder.New())
	if err := s.run(); err != nil {
		t.Fatal(err)
	}
	s.transcoder.Reset()
	s.renditions = nil
	if err := s.run(); err != nil {
		t.Fatal(err)
	}
	if got := s.transcoder.EncodedLevels(); len(got) != 0 {
		t.Errorf("chuyển mã lại %v", got)
	}
	if got := s.levels(); !slices.Equal(got, []int{360, 540, 720}) {
		t.Errorf("báo lại %v", got)
	}
	if !strings.Contains(string(s.object(t, prefix+"/master.m3u8").Body), "720p/index.m3u8") {
		t.Error("master thiếu 720p")
	}
}

func TestMucLoiKhongGhiIndexVaBaoDungMuc(t *testing.T) {
	transcoder := faketranscoder.New()
	transcoder.FailOn(720, true)
	s := newSetup(t, transcoder)
	err := s.run()
	var levelErr *transcode.LevelError
	if !errors.As(err, &levelErr) || levelErr.Level != 720 || err.Error() != "FFmpeg lỗi giả ở 720p" {
		t.Fatalf("được %v", err)
	}
	if _, ok := s.storage.Object(prefix + "/720p/index.m3u8"); ok {
		t.Error("mức lỗi vẫn có index.m3u8")
	}
}

func TestDoanCuoiQuaNganThiLoiVaKhongTaiLen(t *testing.T) {
	transcoder := faketranscoder.New()
	transcoder.Playlist = "#EXTM3U\n#EXTINF:2.0,\nseg_000.ts\n#EXTINF:0.2,\nseg_001.ts\n"
	s := newSetup(t, transcoder)
	var levelErr *transcode.LevelError
	if err := s.run(); !errors.As(err, &levelErr) || levelErr.Level != 360 {
		t.Fatalf("được %v", err)
	}
	if _, ok := s.storage.Object(prefix + "/360p/seg_000.ts"); ok {
		t.Error("vẫn tải đoạn lên")
	}
}

func TestKhongCoFileGocThiLoiOMucThapNhat(t *testing.T) {
	s := newSetup(t, faketranscoder.New())
	s.storage.GetErr = errors.New("không có file gốc")
	err := s.run()
	var levelErr *transcode.LevelError
	if !errors.As(err, &levelErr) || levelErr.Level != 360 || err.Error() != "không có file gốc" {
		t.Fatalf("được %v", err)
	}
}

func TestXoaThuMucTamCaKhiThanhCongVaKhiLoi(t *testing.T) {
	transcoder := faketranscoder.New()
	s := newSetup(t, transcoder)
	countWorkDirs := func() int {
		entries, err := os.ReadDir(s.job.TempDir)
		if err != nil {
			t.Fatal(err)
		}
		return len(entries)
	}
	if err := s.run(); err != nil {
		t.Fatal(err)
	}
	if n := countWorkDirs(); n != 0 {
		t.Errorf("còn %d thư mục tạm sau khi xong", n)
	}
	transcoder.FailOn(360, true)
	failing := newSetup(t, transcoder)
	failing.job.TempDir = s.job.TempDir
	if err := failing.run(); err == nil {
		t.Fatal("cần lỗi")
	}
	if n := countWorkDirs(); n != 0 {
		t.Errorf("còn %d thư mục tạm sau khi lỗi", n)
	}
}

func TestHuyCtxThiDungNgay(t *testing.T) {
	transcoder := faketranscoder.New()
	ctx, cancel := context.WithCancel(context.Background())
	transcoder.BeforeEncode = func(ctx context.Context, _ transcode.EncodeLevelInput) error {
		cancel()
		<-ctx.Done()
		return ctx.Err()
	}
	s := newSetup(t, transcoder)
	if err := s.job.Run(ctx, request); !errors.Is(err, context.Canceled) {
		t.Fatalf("được %v", err)
	}
	if len(s.renditions) != 0 {
		t.Errorf("vẫn báo %v", s.levels())
	}
}
