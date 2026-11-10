package events

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

const validEnvelope = `{"eventId":"5f3c7d2a-1b4e-4c8f-9a0b-2d6e8f1a3c5b","type":"content.media.transcode_requested","version":1,` +
	`"occurredAt":"2026-11-09T04:35:05.370Z","producer":"core-api/content","userId":"22222222-2222-4222-8222-222222222222",` +
	`"payload":{"assetId":"11111111-1111-4111-8111-111111111111","sourceKey":"dev/test/uploads/a/original.mp4","revision":2}}`

func TestParseEnvelopeHopLe(t *testing.T) {
	envelope, err := ParseEnvelope(validEnvelope)
	if err != nil {
		t.Fatal(err)
	}
	request, err := ParseTranscodeRequested(envelope.Payload)
	if err != nil {
		t.Fatal(err)
	}
	if request.Revision != 2 || request.SourceKey != "dev/test/uploads/a/original.mp4" {
		t.Errorf("được %+v", request)
	}
}

func TestParseEnvelopeTuChoi(t *testing.T) {
	cases := map[string]string{
		"không phải JSON":   `{không phải json`,
		"eventId sai":       strings.Replace(validEnvelope, "5f3c7d2a-1b4e-4c8f", "5f3c7d2a-1b4e-0c8f", 1),
		"type sai":          strings.Replace(validEnvelope, "content.media.transcode_requested", "Content", 1),
		"version 0":         strings.Replace(validEnvelope, `"version":1`, `"version":0`, 1),
		"occurredAt có múi": strings.Replace(validEnvelope, "05.370Z", "05.370+07:00", 1),
		"thiếu producer":    strings.Replace(validEnvelope, `"core-api/content"`, `""`, 1),
		"userId sai":        strings.Replace(validEnvelope, "22222222-2222-4222", "nope", 1),
		"payload là mảng":   `{"eventId":"5f3c7d2a-1b4e-4c8f-9a0b-2d6e8f1a3c5b","type":"a.b","version":1,"occurredAt":"2026-11-09T04:35:05Z","producer":"x","payload":[]}`,
		"dữ liệu thừa":      validEnvelope + `{}`,
	}
	for name, raw := range cases {
		if _, err := ParseEnvelope(raw); err == nil {
			t.Errorf("%s: phải bị từ chối", name)
		}
	}
}

func TestParseEnvelopeUserIdNullHoacThieu(t *testing.T) {
	for _, raw := range []string{
		strings.Replace(validEnvelope, `"22222222-2222-4222-8222-222222222222"`, "null", 1),
		strings.Replace(validEnvelope, `"userId":"22222222-2222-4222-8222-222222222222",`, "", 1),
	} {
		envelope, err := ParseEnvelope(raw)
		if err != nil || envelope.UserID != nil {
			t.Errorf("được %+v, %v", envelope, err)
		}
	}
}

func TestParseTranscodeRequestedTuChoi(t *testing.T) {
	cases := []string{
		`{"assetId":"x","sourceKey":"k","revision":1}`,
		`{"assetId":"11111111-1111-4111-8111-111111111111","sourceKey":"","revision":1}`,
		`{"assetId":"11111111-1111-4111-8111-111111111111","sourceKey":"k","revision":0}`,
		`{"assetId":"11111111-1111-4111-8111-111111111111","sourceKey":"k","revision":1.5}`,
	}
	for _, payload := range cases {
		if _, err := ParseTranscodeRequested(json.RawMessage(payload)); err == nil {
			t.Errorf("%s: phải bị từ chối", payload)
		}
	}
}

func TestNewGiuUserIdTraceIdVaDungDinhDang(t *testing.T) {
	cause, err := ParseEnvelope(strings.Replace(validEnvelope, `"version":1,`, `"version":1,"traceId":"abc",`, 1))
	if err != nil {
		t.Fatal(err)
	}
	envelope, err := New(TypeRenditionCompleted, "video-worker", cause, map[string]int{"level": 360})
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(envelope)
	parsed, err := ParseEnvelope(string(body))
	if err != nil {
		t.Fatalf("sự kiện tạo ra không qua được kiểm tra: %v\n%s", err, body)
	}
	if *parsed.UserID != "22222222-2222-4222-8222-222222222222" || *parsed.TraceID != "abc" || parsed.Producer != "video-worker" {
		t.Errorf("được %s", body)
	}

	// Sự kiện gốc không có userId thì ghi null, giống `request.userId ?? null`.
	anonymous := cause
	anonymous.UserID, anonymous.TraceID = nil, nil
	envelope, _ = New(TypeTranscodeFailed, "video-worker", anonymous, map[string]int{})
	body, _ = json.Marshal(envelope)
	if !strings.Contains(string(body), `"userId":null`) || strings.Contains(string(body), "traceId") {
		t.Errorf("được %s", body)
	}
}

func TestFailureReason(t *testing.T) {
	long := strings.Repeat("ữ", 600)
	if got := FailureReason(errors.New(long)); len([]rune(got)) != 500 || !strings.HasPrefix(long, got) {
		t.Errorf("cắt sai: %d ký tự", len([]rune(got)))
	}
	if got := FailureReason(errors.New("")); got != "Không rõ lỗi" {
		t.Errorf("được %q", got)
	}
}
