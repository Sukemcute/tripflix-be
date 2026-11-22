// Package events đọc, tạo sự kiện đúng eventEnvelopeSchema và các schema payload trong libs/contracts.
package events

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// Envelope giống eventEnvelopeSchema của libs/contracts.
type Envelope struct {
	EventID    string          `json:"eventId"`
	Type       string          `json:"type"`
	Version    int             `json:"version"`
	OccurredAt string          `json:"occurredAt"`
	Producer   string          `json:"producer"`
	TraceID    *string         `json:"traceId,omitempty"`
	UserID     *string         `json:"userId"`
	Payload    json.RawMessage `json:"payload"`
}

// Giống z.uuid() của zod: chỉ nhận UUID chuẩn RFC 9562, cùng hai giá trị đặc biệt nil và max.
var (
	uuidPattern      = regexp.MustCompile(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|[fF]{8}-[fF]{4}-[fF]{4}-[fF]{4}-[fF]{12})$`)
	eventTypePattern = regexp.MustCompile(`^[a-z]+(\.[a-z_]+)+$`)
	// Giống z.iso.datetime(): giờ UTC có chữ Z, phần lẻ của giây tuỳ ý.
	isoDateTimePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$`)
)

func IsUUID(value string) bool { return uuidPattern.MatchString(value) }

// ParseEnvelope đọc chuỗi trong trường "event" của stream. Lỗi nghĩa là thử lại cũng vô ích.
func ParseEnvelope(raw string) (Envelope, error) {
	var envelope Envelope
	decoder := json.NewDecoder(strings.NewReader(raw))
	if err := decoder.Decode(&envelope); err != nil {
		return Envelope{}, fmt.Errorf("sự kiện không phải JSON hợp lệ: %w", err)
	}
	if decoder.More() {
		return Envelope{}, errors.New("sự kiện có dữ liệu thừa sau JSON")
	}
	switch {
	case !IsUUID(envelope.EventID):
		return Envelope{}, errors.New("eventId không phải UUID")
	case !eventTypePattern.MatchString(envelope.Type):
		return Envelope{}, errors.New("type không đúng dạng")
	case envelope.Version <= 0:
		return Envelope{}, errors.New("version phải là số nguyên dương")
	case !isValidDateTime(envelope.OccurredAt):
		return Envelope{}, errors.New("occurredAt không phải thời điểm ISO giờ UTC")
	case envelope.Producer == "":
		return Envelope{}, errors.New("thiếu producer")
	case envelope.UserID != nil && !IsUUID(*envelope.UserID):
		return Envelope{}, errors.New("userId không phải UUID")
	}
	if payload := bytes.TrimSpace(envelope.Payload); len(payload) == 0 || payload[0] != '{' {
		return Envelope{}, errors.New("payload phải là object")
	}
	return envelope, nil
}

func isValidDateTime(value string) bool {
	if !isoDateTimePattern.MatchString(value) {
		return false
	}
	for _, layout := range []string{"2006-01-02T15:04Z", time.RFC3339Nano} {
		if _, err := time.Parse(layout, value); err == nil {
			return true
		}
	}
	return false
}

// New tạo sự kiện mới, giữ userId và traceId của sự kiện gốc để lần theo được.
func New(eventType, producer string, cause Envelope, payload any) (Envelope, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return Envelope{}, err
	}
	return Envelope{
		EventID:    newUUIDv4(),
		Type:       eventType,
		Version:    1,
		OccurredAt: time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		Producer:   producer,
		TraceID:    cause.TraceID,
		UserID:     cause.UserID,
		Payload:    body,
	}, nil
}

func newUUIDv4() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
