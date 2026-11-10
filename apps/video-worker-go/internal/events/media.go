package events

import (
	"encoding/json"
	"errors"
	"fmt"
	"unicode/utf8"
)

const (
	TypeTranscodeRequested = "content.media.transcode_requested"
	TypeRenditionCompleted = "media.rendition.completed"
	TypeTranscodeFailed    = "media.transcode.failed"
	maxFailureReasonRunes  = 500
	defaultFailureReason   = "Không rõ lỗi"
)

// TranscodeRequested là payload của content.media.transcode_requested v1.
type TranscodeRequested struct {
	AssetID   string `json:"assetId"`
	SourceKey string `json:"sourceKey"`
	Revision  int    `json:"revision"`
}

// ParseTranscodeRequested kiểm như ContentMediaTranscodeRequestedV1Schema.
func ParseTranscodeRequested(payload json.RawMessage) (TranscodeRequested, error) {
	var request TranscodeRequested
	if err := json.Unmarshal(payload, &request); err != nil {
		return TranscodeRequested{}, fmt.Errorf("payload transcode_requested không hợp lệ: %w", err)
	}
	switch {
	case !IsUUID(request.AssetID):
		return TranscodeRequested{}, errors.New("assetId không phải UUID")
	case request.SourceKey == "":
		return TranscodeRequested{}, errors.New("thiếu sourceKey")
	case request.Revision <= 0:
		return TranscodeRequested{}, errors.New("revision phải là số nguyên dương")
	}
	return request, nil
}

// TranscodeFailed là payload của media.transcode.failed v1.
type TranscodeFailed struct {
	AssetID  string `json:"assetId"`
	Level    int    `json:"level"`
	Reason   string `json:"reason"`
	Attempts int    `json:"attempts"`
}

// FailureReason cắt lý do còn 500 ký tự, không cắt giữa một ký tự UTF-8.
func FailureReason(err error) string {
	reason := ""
	if err != nil {
		reason = err.Error()
	}
	if utf8.RuneCountInString(reason) > maxFailureReasonRunes {
		reason = string([]rune(reason)[:maxFailureReasonRunes])
	}
	if reason == "" {
		return defaultFailureReason
	}
	return reason
}
