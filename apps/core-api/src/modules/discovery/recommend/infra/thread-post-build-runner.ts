import { Worker } from 'node:worker_threads';
import type { PostBuildRunner, PostBuildSession } from '../application/ports.js';
import type { PostBuilder, PostBuildItem, PostBuildOutput } from '../domain/contracts.js';
import type { PostBuildReply } from './post-build.worker.js';

const WORKER_URL = new URL('./post-build.worker.js', import.meta.url);

/**
 * Chạy post builder trong worker_thread: event loop chỉ tốn phần chép dữ liệu (~0,1 giây gửi 41k bài, đo 27/11) thay vì
 * cả vòng lặp tính điểm (~3 giây), và admin dừng khẩn cấp thì terminate() cắt ngay giữa vòng lặp.
 * Một worker cho cả lượt: bài chép sang một lần, các builder dùng chung. Builder chỉ được gọi theo khoá (đọc từ BUILDERS
 * trong worker), nên chạy đúng code đã build, không nhận hàm từ ngoài.
 */
export class ThreadPostBuildRunner implements PostBuildRunner {
  async open(items: PostBuildItem[], now: Date, signal?: AbortSignal): Promise<PostBuildSession> {
    signal?.throwIfAborted();
    const worker = new Worker(WORKER_URL, { workerData: { items, now: now.toISOString() } });
    const pending = new Map<number, { resolve: (out: PostBuildOutput[]) => void; reject: (error: unknown) => void }>();
    let nextId = 0;
    let failure: unknown = null;
    const failAll = (error: unknown) => {
      failure ??= error;
      for (const p of pending.values()) p.reject(failure);
      pending.clear();
    };
    worker.on('message', (reply: PostBuildReply) => {
      const p = pending.get(reply.id);
      pending.delete(reply.id);
      if (reply.ok) p?.resolve(reply.out as PostBuildOutput[]);
      else p?.reject(new Error(reply.message));
    });
    worker.on('error', failAll);
    worker.on('exit', (code) => failAll(new Error(`Worker tính điểm bài dừng (mã ${code})`)));
    const onAbort = () => {
      failAll(signal!.reason);
      void worker.terminate();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    return {
      build: (builder: PostBuilder) =>
        new Promise<PostBuildOutput[]>((resolve, reject) => {
          if (failure) return reject(failure);
          const id = nextId++;
          pending.set(id, { resolve, reject });
          worker.postMessage({ id, key: builder.key });
        }),
      close: async () => {
        signal?.removeEventListener('abort', onAbort);
        failure ??= new Error('Phiên tính điểm bài đã đóng');
        await worker.terminate();
      },
    };
  }
}
