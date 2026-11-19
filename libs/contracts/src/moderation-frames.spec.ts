import { describe, it, expect } from 'vitest';
import { sampleFrameTimes, MediaFramesCompletedV1Schema, FRAME_POLICY } from './moderation-frames.js';
describe('video sampling contract', () => {
  it('covers start/middle/end, bounds frame budget and rejects out-of-scope videos', () => {
    expect(sampleFrameTimes(10_000)).toEqual([0,4950,9900]);
    expect(sampleFrameTimes(1)).toEqual([0]);
    expect(sampleFrameTimes(300_000)).toHaveLength(24);
    expect(sampleFrameTimes(300_000).at(-1)).toBe(299900);
    for (const value of [0,300001,NaN,Infinity,1.5]) expect(() => sampleFrameTimes(value)).toThrow();
  });
  it('rejects partial manifests, wrong paths and duplicate timestamps', () => {
    const id='11111111-1111-4111-8111-111111111111';
    const hlsPrefix=`dev/videos/${id}/r1`;
    const frames=sampleFrameTimes(10000).map((timestampMs)=>({timestampMs,key:`${hlsPrefix}/moderation/${FRAME_POLICY}/${id}/${timestampMs}.jpg`}));
    const valid={assetId:id,requestId:id,hlsPrefix,policy:FRAME_POLICY,durationMs:10000,frames};
    expect(MediaFramesCompletedV1Schema.safeParse(valid).success).toBe(true);
    expect(MediaFramesCompletedV1Schema.safeParse({...valid,frames:frames.slice(0,1)}).success).toBe(false);
    expect(MediaFramesCompletedV1Schema.safeParse({...valid,frames:[frames[0],frames[0],frames[2]]}).success).toBe(false);
    expect(MediaFramesCompletedV1Schema.safeParse({...valid,frames:frames.map(f=>({...f,key:'other.jpg'}))}).success).toBe(false);
  });
});
