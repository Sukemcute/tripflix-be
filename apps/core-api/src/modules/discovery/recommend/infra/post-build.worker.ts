import { parentPort, workerData } from 'node:worker_threads';
import { buildPostScores } from '../application/post-build-runner.js';
import type { PostBuildItem } from '../domain/contracts.js';
import { BUILDERS } from '../domain/registry.js';

/** Entry của worker_thread chạy post builder (xem ThreadPostBuildRunner). Bài nhận một lần qua workerData, mỗi tin nhắn là một builder. */
export interface PostBuildRequest {
  id: number;
  key: string;
}
export type PostBuildReply = { id: number; ok: true; out: unknown[] } | { id: number; ok: false; message: string };

const { items, now } = workerData as { items: PostBuildItem[]; now: string };
const at = new Date(now);

parentPort!.on('message', async ({ id, key }: PostBuildRequest) => {
  let reply: PostBuildReply;
  try {
    const entry = BUILDERS.get(key);
    if (entry?.kind !== 'post') throw new Error(`Không có post builder ${key}`);
    reply = { id, ok: true, out: await buildPostScores(entry.builder, items, at) };
  } catch (error) {
    reply = { id, ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  parentPort!.postMessage(reply);
});
