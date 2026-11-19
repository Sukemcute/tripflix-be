import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { Transactional, type Db } from '@tripflix/db';
import { FRAME_POLICY, type MediaFramesCompletedV1 } from '@tripflix/contracts';
import { OutboxWriter } from '@tripflix/outbox';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { contentOutboxEvents, mediaAssets, mediaFrameScans } from '../../db/schema/index.js';

// Three 5-minute worker attempts plus reclaim delays must fit before Core reissues a request.
const EXTRACTION_REQUEST_TIMEOUT_MS = 20 * 60_000;

/** Extraction has its own lifecycle; it never changes whether the video is playable. */
export class MediaFramesUseCases {
  constructor(private readonly getDb: () => Db) {}
  private get db() {
    return this.getDb();
  }
  private get outbox() {
    return new OutboxWriter(this.getDb, contentOutboxEvents, 'core-api/content');
  }

  @Transactional('content')
  async ensure(assetIds: string[], actorId?: string) {
    if (!assetIds.length) return;
    const assets = await this.db
      .select()
      .from(mediaAssets)
      .where(
        and(
          inArray(mediaAssets.id, assetIds),
          eq(mediaAssets.kind, 'video'),
          eq(mediaAssets.status, 'ready'),
        ),
      )
      .orderBy(asc(mediaAssets.id))
      .for('update');
    for (const asset of assets) {
      if (!asset.hlsPrefix) continue;
      const [previous] = await this.db
        .select()
        .from(mediaFrameScans)
        .where(
          and(
            eq(mediaFrameScans.assetId, asset.id),
            eq(mediaFrameScans.revision, asset.hlsPrefix),
            eq(mediaFrameScans.policy, FRAME_POLICY),
          ),
        );
      if (actorId && previous?.status !== 'failed')
        throw new ConflictException('Chỉ thử lại job trích khung hình đã thất bại');
      const sameSource = previous?.sourceKey === asset.sourceKey;
      if (
        !actorId &&
        sameSource &&
        previous &&
        (previous.status !== 'requested' || previous.nextAttemptAt.getTime() > Date.now())
      )
        continue;
      if (!actorId && sameSource && previous && previous.attempts >= 3) {
        await this.db
          .update(mediaFrameScans)
          .set({ status: 'failed', errorCode: 'extraction_timeout', updatedAt: new Date() })
          .where(eq(mediaFrameScans.id, previous.id));
        await this.outbox.add({ type: 'content.media.frames.changed', payload: { assetId: asset.id } });
        continue;
      }
      const requestId = randomUUID();
      const values = {
        assetId: asset.id,
        revision: asset.hlsPrefix,
        sourceKey: asset.sourceKey,
        policy: FRAME_POLICY,
        requestId,
        status: 'requested' as const,
        attempts: actorId || !sameSource ? 1 : (previous?.attempts ?? 0) + 1,
        manifest: null,
        errorCode: null,
        nextAttemptAt: new Date(Date.now() + EXTRACTION_REQUEST_TIMEOUT_MS),
        updatedAt: new Date(),
        ...(actorId ? { retriedBy: actorId, retriedAt: new Date() } : {}),
      };
      await this.db
        .insert(mediaFrameScans)
        .values(values)
        .onConflictDoUpdate({
          target: [mediaFrameScans.assetId, mediaFrameScans.revision, mediaFrameScans.policy],
          set: values,
        });
      await this.outbox.add({
        type: 'content.media.frames.requested',
        userId: actorId ?? asset.ownerId,
        payload: {
          assetId: asset.id,
          requestId,
          sourceKey: asset.sourceKey,
          hlsPrefix: asset.hlsPrefix,
          policy: FRAME_POLICY,
        },
      });
    }
  }

  async list(assetIds: string[]) {
    if (!assetIds.length) return [];
    return this.db
      .select({ scan: mediaFrameScans })
      .from(mediaFrameScans)
      .innerJoin(
        mediaAssets,
        and(
          eq(mediaAssets.id, mediaFrameScans.assetId),
          eq(mediaAssets.hlsPrefix, mediaFrameScans.revision),
          eq(mediaAssets.sourceKey, mediaFrameScans.sourceKey),
          eq(mediaAssets.status, 'ready'),
        ),
      )
      .where(and(inArray(mediaFrameScans.assetId, assetIds), eq(mediaFrameScans.policy, FRAME_POLICY)))
      .then((rows) => rows.map((r) => r.scan));
  }

  @Transactional('content')
  async complete(result: MediaFramesCompletedV1) {
    await this.record(result.assetId, result.requestId, result, null);
  }

  @Transactional('content')
  async fail(assetId: string, requestId: string, errorCode: string) {
    await this.record(assetId, requestId, null, errorCode);
  }

  private async record(
    assetId: string,
    requestId: string,
    manifest: MediaFramesCompletedV1 | null,
    errorCode: string | null,
  ) {
    const [asset] = await this.db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId)).for('update');
    if (!asset || asset.status !== 'ready' || !asset.hlsPrefix) return;
    const updated = await this.db
      .update(mediaFrameScans)
      .set({
        status: manifest ? 'ready' : 'failed',
        manifest,
        errorCode,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mediaFrameScans.assetId, assetId),
          eq(mediaFrameScans.requestId, requestId),
          eq(mediaFrameScans.revision, asset.hlsPrefix),
          eq(mediaFrameScans.sourceKey, asset.sourceKey),
          eq(mediaFrameScans.policy, FRAME_POLICY),
          eq(mediaFrameScans.status, 'requested'),
          manifest ? eq(mediaFrameScans.revision, manifest.hlsPrefix) : sql`true`,
        ),
      )
      .returning({ id: mediaFrameScans.id });
    if (updated.length) await this.outbox.add({ type: 'content.media.frames.changed', payload: { assetId } });
  }
}
