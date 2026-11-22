// Package storage ghi, đọc file trên S3. Mọi key là key đầy đủ, lấy từ ResolveKey, giống libs/storage.
package storage

import (
	"context"
	"errors"
	"io"
	"strings"
)

// ErrNotFound: không có object với key đã cho.
var ErrNotFound = errors.New("không thấy object")

type PutObjectInput struct {
	Key string
	// Body đọc được nhiều lần (ví dụ *os.File), để SDK tính dung lượng và gửi lại khi lỗi mạng.
	Body         io.ReadSeeker
	ContentType  string
	CacheControl string
}

// ObjectStorage: code nghiệp vụ chỉ phụ thuộc interface này, để test chạy bằng bộ nhớ mà không cần mạng.
type ObjectStorage interface {
	// ResolveKey thêm tiền tố môi trường (ví dụ dev/phong/) vào key tương đối.
	ResolveKey(relativeKey string) string
	// GetObject trả về ErrNotFound khi không có object.
	GetObject(ctx context.Context, key string) (io.ReadCloser, error)
	HasObject(ctx context.Context, key string) (bool, error)
	PutObject(ctx context.Context, input PutObjectInput) error
}

// JoinKeyPrefix giống joinKeyPrefix của libs/storage: bỏ dấu / thừa ở chỗ nối.
func JoinKeyPrefix(keyPrefix, relativeKey string) string {
	prefix := strings.TrimRight(keyPrefix, "/")
	key := strings.TrimLeft(relativeKey, "/")
	if prefix == "" {
		return key
	}
	return prefix + "/" + key
}
