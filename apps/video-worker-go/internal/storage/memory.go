package storage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"sync"
)

// StoredObject là object lưu trong MemoryStorage, cho test đọc lại.
type StoredObject struct {
	Body         []byte
	ContentType  string
	CacheControl string
}

// MemoryStorage lưu object trong bộ nhớ, dùng cho test.
type MemoryStorage struct {
	keyPrefix string
	mu        sync.Mutex
	objects   map[string]StoredObject
	// GetErr, nếu khác nil, được trả về ở lần GetObject kế tiếp rồi tự xoá.
	GetErr error
}

func NewMemoryStorage(keyPrefix string) *MemoryStorage {
	return &MemoryStorage{keyPrefix: keyPrefix, objects: map[string]StoredObject{}}
}

func (m *MemoryStorage) ResolveKey(relativeKey string) string {
	return JoinKeyPrefix(m.keyPrefix, relativeKey)
}

func (m *MemoryStorage) GetObject(_ context.Context, key string) (io.ReadCloser, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.GetErr; err != nil {
		m.GetErr = nil
		return nil, err
	}
	object, ok := m.objects[key]
	if !ok {
		return nil, fmt.Errorf("Không thấy %s: %w", key, ErrNotFound)
	}
	return io.NopCloser(bytes.NewReader(object.Body)), nil
}

func (m *MemoryStorage) HasObject(_ context.Context, key string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.objects[key]
	return ok, nil
}

func (m *MemoryStorage) PutObject(_ context.Context, input PutObjectInput) error {
	body, err := io.ReadAll(input.Body)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.objects[input.Key] = StoredObject{Body: body, ContentType: input.ContentType, CacheControl: input.CacheControl}
	return nil
}

// Object trả về object đã lưu, cho test.
func (m *MemoryStorage) Object(key string) (StoredObject, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	object, ok := m.objects[key]
	return object, ok
}
