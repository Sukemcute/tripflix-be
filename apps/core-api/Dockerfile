# syntax=docker/dockerfile:1
# Build với context là gốc repo: docker build -f apps/core-api/Dockerfile --target prod .
# Stage dev dùng cho máy local (pnpm stack:up / stack:watch); stage prod là image đẩy lên GHCR.
ARG APP=@tripflix/core-api

FROM node:24-slim AS base
# turbo chạy nhiều `pnpm run` song song: bước kiểm deps trước khi chạy đọc file trạng thái đang ghi dở, lỗi "Unexpected end of JSON input".
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true npm_config_verify_deps_before_run=false
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
# Chỉ watch app; libs build một lần (dev dependsOn ^build). Sửa libs: compose watch sync+restart.
CMD pnpm turbo run dev --filter=${APP}

FROM dev AS build
ARG APP
RUN pnpm turbo run build --filter=${APP}...
RUN pnpm --filter=${APP} deploy --prod --legacy /out

FROM node:24-slim AS prod
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out .
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
