package transcode

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
)

// TestParity in kết quả cho một lưới đầu vào để so với bản TypeScript (xem README, mục So với bản TypeScript).
// Chỉ chạy khi có PARITY_CASES và PARITY_OUT.
func TestParity(t *testing.T) {
	casesPath, outPath := os.Getenv("PARITY_CASES"), os.Getenv("PARITY_OUT")
	if casesPath == "" || outPath == "" {
		t.Skip("đặt PARITY_CASES, PARITY_OUT để chạy")
	}
	raw, err := os.ReadFile(casesPath)
	if err != nil {
		t.Fatal(err)
	}
	var cases struct {
		Sizes     [][2]int          `json:"sizes"`
		Durations []float64         `json:"durations"`
		Audio     []bool            `json:"audio"`
		Probes    []json.RawMessage `json:"probes"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	type size struct {
		Width  int `json:"width"`
		Height int `json:"height"`
	}
	type row struct {
		K      []any      `json:"k"`
		Rungs  []int      `json:"rungs"`
		Aspect string     `json:"aspect"`
		Dur    int        `json:"dur"`
		Sizes  []size     `json:"sizes"`
		Master string     `json:"master"`
		Enc    [][]string `json:"enc"`
		Poster [][]string `json:"poster"`
	}
	var lines []string
	encode := func(value any) {
		var b bytes.Buffer
		encoder := json.NewEncoder(&b)
		encoder.SetEscapeHTML(false)
		if err := encoder.Encode(value); err != nil {
			t.Fatal(err)
		}
		lines = append(lines, strings.TrimSuffix(b.String(), "\n"))
	}
	for _, s := range cases.Sizes {
		for _, d := range cases.Durations {
			for _, a := range cases.Audio {
				v := VideoMetadata{DisplayWidth: s[0], DisplayHeight: s[1], DurationSeconds: d, HasAudio: a}
				rungs := SelectRungs(v)
				r := row{K: []any{s[0], s[1], d, a}, Rungs: levels(rungs), Aspect: ClassifyAspect(v), Dur: RoundUpDurationSeconds(d), Master: BuildMasterPlaylist(rungs, v)}
				for _, rung := range rungs {
					w, h := OutputSize(v, rung.Level)
					r.Sizes = append(r.Sizes, size{w, h})
					r.Enc = append(r.Enc, BuildEncodeArgs(EncodeLevelInput{SourcePath: "/w/source", OutputDir: fmt.Sprintf("/w/%dp", rung.Level), Rung: rung, Video: v}))
				}
				for _, pw := range PosterWidths {
					r.Poster = append(r.Poster, BuildPosterArgs(CreatePosterInput{SourcePath: "/w/source", OutputPath: fmt.Sprintf("/w/poster_%d.jpg", pw), Width: pw, Video: v}))
				}
				encode(r)
			}
		}
	}
	for _, probe := range cases.Probes {
		m, err := ParseProbeOutput(probe)
		if err != nil {
			t.Fatal(err)
		}
		encode(map[string]any{"displayWidth": m.DisplayWidth, "displayHeight": m.DisplayHeight, "durationSeconds": m.DurationSeconds, "hasAudio": m.HasAudio})
	}
	if err := os.WriteFile(outPath, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}
