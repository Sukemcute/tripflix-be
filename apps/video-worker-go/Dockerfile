# syntax=docker/dockerfile:1
# Build với context là gốc repo, giống các app khác: docker build -f apps/video-worker-go/Dockerfile --target prod .
FROM golang:1.27-bookworm AS build
WORKDIR /src
COPY apps/video-worker-go/go.mod apps/video-worker-go/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY apps/video-worker-go/ ./
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/video-worker ./cmd/video-worker

# Cùng Debian bookworm với node:24-slim của bản TypeScript, để FFmpeg cùng phiên bản và file HLS ra giống nhau.
FROM debian:bookworm-slim AS prod
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home worker
COPY --from=build /out/video-worker /usr/local/bin/video-worker
ENV NODE_ENV=production
USER worker
CMD ["video-worker"]
