package storage

import (
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
)

type S3Storage struct {
	client    *s3.Client
	bucket    string
	keyPrefix string
}

// NewS3Storage lấy key AWS từ biến môi trường AWS_* như SDK mặc định.
func NewS3Storage(ctx context.Context, region, bucket, keyPrefix string) (*S3Storage, error) {
	cfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion(region),
		// Giống libs/storage: chỉ gửi checksum khi S3 bắt buộc.
		config.WithRequestChecksumCalculation(aws.RequestChecksumCalculationWhenRequired),
		config.WithResponseChecksumValidation(aws.ResponseChecksumValidationWhenRequired),
	)
	if err != nil {
		return nil, fmt.Errorf("không đọc được cấu hình AWS: %w", err)
	}
	return &S3Storage{client: s3.NewFromConfig(cfg), bucket: bucket, keyPrefix: keyPrefix}, nil
}

func (s *S3Storage) ResolveKey(relativeKey string) string {
	return JoinKeyPrefix(s.keyPrefix, relativeKey)
}

func isNotFound(err error) bool {
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.ErrorCode() {
		case "NoSuchKey", "NotFound":
			return true
		}
	}
	return false
}

func (s *S3Storage) GetObject(ctx context.Context, key string) (io.ReadCloser, error) {
	output, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: &s.bucket, Key: &key})
	if err != nil {
		if isNotFound(err) {
			return nil, fmt.Errorf("Không thấy %s trên S3: %w", key, ErrNotFound)
		}
		return nil, err
	}
	return output.Body, nil
}

func (s *S3Storage) HasObject(ctx context.Context, key string) (bool, error) {
	_, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: &s.bucket, Key: &key})
	if err == nil {
		return true, nil
	}
	if isNotFound(err) {
		return false, nil
	}
	return false, err
}

func (s *S3Storage) PutObject(ctx context.Context, input PutObjectInput) error {
	params := &s3.PutObjectInput{
		Bucket:      &s.bucket,
		Key:         &input.Key,
		Body:        input.Body,
		ContentType: &input.ContentType,
	}
	if input.CacheControl != "" {
		params.CacheControl = &input.CacheControl
	}
	_, err := s.client.PutObject(ctx, params)
	return err
}
