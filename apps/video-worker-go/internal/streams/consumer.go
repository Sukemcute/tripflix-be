// Package streams đọc, ghi Redis Streams giống libs/event-bus (RedisStreamsEventBus, RedisStreamsConsumer).
package streams

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/Sukemcute/tripflix-be/apps/video-worker-go/internal/events"
)

const (
	Media      = "stream:media"
	DeadLetter = "stream:dead-letter"
	// Giống RedisStreamsEventBus: giữ khoảng 100 000 sự kiện mỗi stream.
	maxStreamLength = 100_000
)

// Publish ghi sự kiện vào stream ở trường "event", giống RedisStreamsEventBus.publish.
func Publish(ctx context.Context, client redis.Cmdable, stream string, envelope events.Envelope) error {
	body, err := json.Marshal(envelope)
	if err != nil {
		return err
	}
	err = client.XAdd(ctx, &redis.XAddArgs{
		Stream: stream,
		MaxLen: maxStreamLength,
		Approx: true,
		Values: []any{"event", string(body)},
	}).Err()
	if err != nil {
		return fmt.Errorf("không ghi được sự kiện %s vào %s: %w", envelope.Type, stream, err)
	}
	return nil
}

// Delivery cho handler biết việc đang làm là lần giao thứ mấy (1 là lần đầu).
type Delivery struct {
	Stream        string
	MessageID     string
	DeliveryCount int64
}

type Handler func(ctx context.Context, event events.Envelope, delivery Delivery) error

// PermanentError: thử lại cũng vô ích, chuyển sang dead-letter ngay.
type PermanentError struct{ Err error }

func (e *PermanentError) Error() string { return e.Err.Error() }
func (e *PermanentError) Unwrap() error { return e.Err }

type ConsumerOptions struct {
	Client   *redis.Client
	Group    string
	Consumer string
	Stream   string
	Handler  Handler
	// Số việc lấy mỗi lần đọc.
	BatchSize int64
	// Thời gian chờ việc mới mỗi lần đọc.
	Block time.Duration
	// Việc đã giao nhưng chưa XACK quá lâu thì replica khác lấy lại.
	ClaimIdle time.Duration
	// Giao quá số lần này thì chuyển sang stream:dead-letter để xem tay.
	MaxDeliveries int64
	OnError       func(err error, delivery *Delivery)
}

// Consumer đọc sự kiện bằng consumer group. Giao ít nhất một lần: xử lý xong mới XACK; lỗi thì để nguyên,
// quá ClaimIdle thì lấy lại; quá MaxDeliveries thì vào dead-letter. Handler phải chịu được việc bị giao lại.
type Consumer struct {
	opts ConsumerOptions
}

func NewConsumer(opts ConsumerOptions) *Consumer {
	if opts.BatchSize == 0 {
		opts.BatchSize = 20
	}
	if opts.Block == 0 {
		opts.Block = 5 * time.Second
	}
	if opts.ClaimIdle == 0 {
		opts.ClaimIdle = time.Minute
	}
	if opts.MaxDeliveries == 0 {
		opts.MaxDeliveries = 5
	}
	if opts.OnError == nil {
		opts.OnError = func(error, *Delivery) {}
	}
	return &Consumer{opts: opts}
}

// EnsureGroup tạo group nếu chưa có, đọc từ đầu stream để không bỏ sót sự kiện phát lúc worker còn tắt.
func (c *Consumer) EnsureGroup(ctx context.Context) error {
	err := c.opts.Client.XGroupCreateMkStream(ctx, c.opts.Stream, c.opts.Group, "0").Err()
	if err != nil && !strings.Contains(err.Error(), "BUSYGROUP") {
		return err
	}
	return nil
}

// Run tạo group rồi đọc việc cho tới khi ctx bị huỷ. Việc đang làm nhận cùng ctx, nên huỷ ctx là dừng việc
// đó và không XACK. Chờ việc mới tối đa Block, nên Run trả về chậm nhất sau Block.
func (c *Consumer) Run(ctx context.Context) error {
	if err := c.EnsureGroup(ctx); err != nil {
		return err
	}
	for ctx.Err() == nil {
		if _, err := c.PollOnce(ctx); err != nil && ctx.Err() == nil {
			c.opts.OnError(err, nil)
			select {
			case <-ctx.Done():
			case <-time.After(time.Second):
			}
		}
	}
	return nil
}

// PollOnce lấy lại việc treo rồi đọc việc mới. Trả về số việc đã XACK.
func (c *Consumer) PollOnce(ctx context.Context) (int, error) {
	handled := 0
	stale, err := c.claimStale(ctx)
	if err != nil {
		return handled, err
	}
	for _, message := range stale {
		count, err := c.readDeliveryCount(ctx, message.ID)
		if err != nil {
			return handled, err
		}
		acked, err := c.process(ctx, message, count)
		if err != nil {
			return handled, err
		}
		if acked {
			handled++
		}
	}
	if ctx.Err() != nil {
		return handled, nil
	}

	fresh, err := c.opts.Client.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group:    c.opts.Group,
		Consumer: c.opts.Consumer,
		Streams:  []string{c.opts.Stream, ">"},
		Count:    c.opts.BatchSize,
		Block:    c.opts.Block,
	}).Result()
	if errors.Is(err, redis.Nil) {
		return handled, nil
	}
	if err != nil {
		return handled, err
	}
	for _, stream := range fresh {
		for _, message := range stream.Messages {
			acked, err := c.process(ctx, message, 1)
			if err != nil {
				return handled, err
			}
			if acked {
				handled++
			}
		}
	}
	return handled, nil
}

func (c *Consumer) claimStale(ctx context.Context) ([]redis.XMessage, error) {
	messages, _, err := c.opts.Client.XAutoClaim(ctx, &redis.XAutoClaimArgs{
		Stream:   c.opts.Stream,
		Group:    c.opts.Group,
		Consumer: c.opts.Consumer,
		MinIdle:  c.opts.ClaimIdle,
		Start:    "0-0",
		Count:    c.opts.BatchSize,
	}).Result()
	if err != nil {
		return nil, err
	}
	// Entry đã bị xoá khỏi stream (MAXLEN) không còn dữ liệu.
	kept := messages[:0]
	for _, message := range messages {
		if len(message.Values) > 0 {
			kept = append(kept, message)
		}
	}
	return kept, nil
}

func (c *Consumer) readDeliveryCount(ctx context.Context, messageID string) (int64, error) {
	rows, err := c.opts.Client.XPendingExt(ctx, &redis.XPendingExtArgs{
		Stream: c.opts.Stream,
		Group:  c.opts.Group,
		Start:  messageID,
		End:    messageID,
		Count:  1,
	}).Result()
	if err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		return 1, nil
	}
	return rows[0].RetryCount, nil
}

// process trả về true khi đã XACK (xử lý xong hoặc chuyển dead-letter). Lỗi trả về là lỗi Redis.
func (c *Consumer) process(ctx context.Context, message redis.XMessage, deliveryCount int64) (bool, error) {
	delivery := Delivery{Stream: c.opts.Stream, MessageID: message.ID, DeliveryCount: deliveryCount}
	raw, _ := message.Values["event"].(string)
	event, err := events.ParseEnvelope(raw)
	if err != nil {
		// Không đọc được thì thử lại cũng vô ích: chuyển dead-letter ngay.
		return true, c.moveToDeadLetter(ctx, delivery, raw, err)
	}
	if deliveryCount > c.opts.MaxDeliveries {
		return true, c.moveToDeadLetter(ctx, delivery, raw, fmt.Errorf("Giao quá %d lần", c.opts.MaxDeliveries))
	}
	if err := c.opts.Handler(ctx, event, delivery); err != nil {
		var permanent *PermanentError
		if errors.As(err, &permanent) {
			return true, c.moveToDeadLetter(ctx, delivery, raw, err)
		}
		c.opts.OnError(err, &delivery)
		return false, nil
	}
	if err := c.opts.Client.XAck(ctx, c.opts.Stream, c.opts.Group, message.ID).Err(); err != nil {
		return false, err
	}
	return true, nil
}

func (c *Consumer) moveToDeadLetter(ctx context.Context, delivery Delivery, raw string, reason error) error {
	err := c.opts.Client.XAdd(ctx, &redis.XAddArgs{
		Stream: DeadLetter,
		Values: []any{
			"event", raw,
			"stream", delivery.Stream,
			"group", c.opts.Group,
			"messageId", delivery.MessageID,
			"reason", reason.Error(),
		},
	}).Err()
	if err != nil {
		return err
	}
	return c.opts.Client.XAck(ctx, delivery.Stream, c.opts.Group, delivery.MessageID).Err()
}

// KeepAlive gọi XCLAIM cho chính mình với JUSTID: đặt lại thời gian im lặng mà không tăng số lần giao,
// để replica khác chỉ nhận lại việc khi replica này thật sự đã chết. Gọi hàm trả về để dừng.
func (c *Consumer) KeepAlive(delivery Delivery, every time.Duration) (stop func()) {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(every)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				err := c.opts.Client.XClaimJustID(ctx, &redis.XClaimArgs{
					Stream:   delivery.Stream,
					Group:    c.opts.Group,
					Consumer: c.opts.Consumer,
					MinIdle:  0,
					Messages: []string{delivery.MessageID},
				}).Err()
				if err != nil && ctx.Err() == nil {
					c.opts.OnError(fmt.Errorf("không báo còn sống được: %w", err), &delivery)
				}
			}
		}
	}()
	return func() {
		cancel()
		<-done
	}
}
