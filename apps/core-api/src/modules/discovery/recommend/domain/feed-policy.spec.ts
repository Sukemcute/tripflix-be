import type { RankedItem } from './contracts.js';
import { applyFeedPolicy, type ViewerSignals } from './feed-policy.js';

const item = (postId: string, score: number, authorId = `a-${postId}`): RankedItem => ({
  postId,
  authorId,
  score,
  source: 'hot',
  breakdown: { hot: score },
  reason: { code: 'trending', text: 'Bài viết thịnh hành trên TripFlix' },
});
const viewer = (over: Partial<ViewerSignals> = {}): ViewerSignals => ({
  userId: 'me',
  seen: new Set(),
  interacted: new Set(),
  ownRecent: new Set(),
  ...over,
});
const ids = (xs: RankedItem[]) => xs.map((x) => x.postId);

describe('applyFeedPolicy', () => {
  const ranked = [item('a', 0.9), item('b', 0.8), item('c', 0.3), item('d', 0.2)];

  it('không có tín hiệu: giữ nguyên thứ tự ranker', () => {
    expect(ids(applyFeedPolicy(ranked, viewer()))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(applyFeedPolicy(ranked, viewer({ userId: null })))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('bài đã xem, đã tương tác chỉ bị phạt điểm, không bị bỏ; hệ số ghi vào breakdown', () => {
    const out = applyFeedPolicy(ranked, viewer({ seen: new Set(['a']), interacted: new Set(['b']) }));
    expect(ids(out)).toEqual(['c', 'd', 'b', 'a']);
    expect(out.find((x) => x.postId === 'a')!.breakdown).toMatchObject({ seenFactor: 0.1, final: 0.09 });
    expect(out.find((x) => x.postId === 'b')!.breakdown).toMatchObject({ interactedFactor: 0.2, final: 0.16 });
  });

  it('phạt chứ không đẩy cuối: bài đã xem rất hợp vẫn có thể đứng trên bài chưa xem điểm rất thấp', () => {
    const out = applyFeedPolicy([item('a', 0.9), item('z', 0.05)], viewer({ seen: new Set(['a']) }));
    expect(ids(out)).toEqual(['a', 'z']);
  });

  it('bài tự đăng gần đây lên đầu, lý do own_post; bài tự đăng không bị phạt "đã tương tác"', () => {
    const mine = [...ranked, item('m1', 0, 'me'), item('m2', 0.85, 'me')];
    const out = applyFeedPolicy(mine, viewer({ ownRecent: new Set(['m1']), interacted: new Set(['m1', 'm2']) }));
    expect(ids(out).slice(0, 3)).toEqual(['m1', 'a', 'm2']);
    expect(out[0]!.reason.code).toBe('own_post');
    expect(out[2]!.breakdown.interactedFactor).toBeUndefined();
  });

  it('người khác không được cộng bài của tác giả: ownRecent chỉ có ở feed của chính họ', () => {
    expect(ids(applyFeedPolicy([item('a', 0.9), item('m1', 0, 'me')], viewer({ userId: 'other' })))).toEqual(['a', 'm1']);
  });

  it('đa dạng tác giả: bài thứ 3 trở đi của cùng tác giả bị nhân 0.5^(n−2), không dồn cuối', () => {
    const same = ['a', 'b', 'c'].map((id) => item(id, 0.5, 'same'));
    expect(ids(applyFeedPolicy([...same, item('d', 0.5, 'other'), item('e', 0.1)], viewer()))).toEqual(['a', 'b', 'd', 'c', 'e']);
  });

  it('bài bị phạt nặng không chiếm suất tác giả', () => {
    const same = [item('a', 0.9, 'same'), item('b', 0.8, 'same'), item('c', 0.7, 'same')];
    const out = applyFeedPolicy(same, viewer({ seen: new Set(['a']) }));
    expect(ids(out)).toEqual(['b', 'c', 'a']);
    expect(out[1]!.breakdown.authorFactor).toBeUndefined();
  });
});
