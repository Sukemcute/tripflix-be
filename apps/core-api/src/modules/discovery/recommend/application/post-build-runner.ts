import type { PostBuilder, PostBuildItem, PostBuildOutput } from '../domain/contracts.js';
import type { PostBuildRunner, PostBuildSession } from './ports.js';

/** Tính điểm một post builder rồi kiểm featuresSchema. Dùng chung cho chạy trong process và trong worker_thread. */
export async function buildPostScores(builder: PostBuilder, items: PostBuildItem[], now: Date): Promise<PostBuildOutput[]> {
  const out = await builder.build(items, now);
  for (const o of out) builder.featuresSchema.parse(o.features);
  return out;
}

/** Chạy ngay trong process (test, công cụ). Chỉ dừng được giữa hai builder: vòng lặp CPU đang chạy thì không ngắt được. */
export class InProcessPostBuildRunner implements PostBuildRunner {
  async open(items: PostBuildItem[], now: Date, signal?: AbortSignal): Promise<PostBuildSession> {
    return {
      build: async (builder) => {
        signal?.throwIfAborted();
        return buildPostScores(builder, items, now);
      },
      close: async () => undefined,
    };
  }
}
