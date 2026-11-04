# syntax=docker/dockerfile:1
# Build với context là gốc repo: docker build -f apps/video-worker/Dockerfile --target prod .
# Stage dev dùng cho máy local (pnpm stack:up / stack:watch); stage prod là image đẩy lên GHCR.
ARG APP=@tripflix/video-worker

FROM node:24-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

# Chỉ giữ phần monorepo mà app cần
FROM base AS prune
ARG APP
COPY . .
RUN pnpm dlx turbo@2.11.10 prune ${APP} --docker

# Cài dependency trước, để sửa code không làm cài lại
FROM base AS deps
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS dev
ARG APP
ENV APP=${APP} NODE_ENV=development
COPY --from=prune /repo/out/full/ .
CMD pnpm turbo run dev --filter=${APP}...

FROM dev AS build
ARG APP
RUN pnpm turbo run build --filter=${APP}...
RUN pnpm --filter=${APP} deploy --prod --legacy /out

FROM node:24-slim AS prod
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out .
USER node
CMD ["node", "dist/main.js"]
