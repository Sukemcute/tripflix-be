package events

import (
	"encoding/json"
	"errors"
)

const TypeFramesRequested = "content.media.frames.requested"
const TypeFramesCompleted = "media.frames.completed"
const TypeFramesFailed = "media.frames.failed"
const FramePolicy = "uniform-v1"

type FramesRequested struct {
	AssetID   string `json:"assetId"`
	RequestID string `json:"requestId"`
	SourceKey string `json:"sourceKey"`
	HLSPrefix string `json:"hlsPrefix"`
	Policy    string `json:"policy"`
}

func ParseFramesRequested(payload json.RawMessage) (FramesRequested, error) {
	var r FramesRequested
	if err := json.Unmarshal(payload, &r); err != nil {
		return r, err
	}
	if !IsUUID(r.AssetID) || !IsUUID(r.RequestID) || r.SourceKey == "" || len(r.SourceKey) > 2048 ||
		r.HLSPrefix == "" || len(r.HLSPrefix) > 1024 || r.Policy != FramePolicy {
		return r, errors.New("job khung hình không hợp lệ")
	}
	return r, nil
}

type ModerationFrame struct {
	TimestampMS int    `json:"timestampMs"`
	Key         string `json:"key"`
}
type FramesCompleted struct {
	AssetID    string            `json:"assetId"`
	RequestID  string            `json:"requestId"`
	HLSPrefix  string            `json:"hlsPrefix"`
	Policy     string            `json:"policy"`
	DurationMS int               `json:"durationMs"`
	Frames     []ModerationFrame `json:"frames"`
}
type FramesFailed struct {
	AssetID   string `json:"assetId"`
	RequestID string `json:"requestId"`
	ErrorCode string `json:"errorCode"`
}
