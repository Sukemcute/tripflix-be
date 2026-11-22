import type { RankedItem } from './contracts.js';
import { applyFeedPolicy, diversify, type ViewerSignals } from './feed-policy.js';

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

describe('diversify', () => {
  const at = (postId: string, score: number, place: string | null, exp: string | null = null, isFocus = false): RankedItem => ({
    ...item(postId, score),
    diversity: { place, exp, isFocus },
  });
  const order = (xs: RankedItem[]) => diversify(xs).map((x) => x.postId);

  it('không có diversity (ranker v0) thì giữ nguyên thứ tự', () => {
    const xs = [item('a', 3), item('b', 2), item('c', 1)];
    expect(diversify(xs)).toBe(xs);
  });

  it('tối đa 2 bài cùng nơi trong 5 bài liền nhau; không bỏ bài, không đổi điểm', () => {
    const xs = [at('n1', 9, 'nt'), at('n2', 8, 'nt'), at('n3', 7, 'nt'), at('d1', 1, 'dl'), at('h1', 0.5, 'hn')];
    const out = diversify(xs);
    expect(out.map((x) => x.postId)).toEqual(['n1', 'n2', 'd1', 'h1', 'n3']);
    expect(out.find((x) => x.postId === 'd1')).toMatchObject({ score: 1, breakdown: { diversityMoved: 1 } });
  });

  it('nơi đang nhắm: được nhiều chỗ hơn nhưng không quá 4 bài liền nhau, không quá 4 trong 10', () => {
    const focus = Array.from({ length: 12 }, (_, i) => at(`f${i}`, 10 - i / 100, 'nt', null, true));
    const others = Array.from({ length: 6 }, (_, i) => at(`o${i}`, 1 - i / 100, `p${i}`));
    const out = order([...focus, ...others]);
    expect(out.slice(0, 5)).toEqual(['f0', 'f1', 'f2', 'f3', 'o0']);
    expect(out.slice(0, 10).filter((id) => id.startsWith('f')).length).toBe(4);
  });

  it('nơi vừa được chú ý: đẩy 4 bài lên đầu dù điểm thấp hơn, các trang sau giảm dần 3, 2, 1', () => {
    const focus = Array.from({ length: 20 }, (_, i) => at(`f${i}`, 1 - i / 100, 'nt', null, true));
    const others = Array.from({ length: 40 }, (_, i) => at(`o${i}`, 5 - i / 100, `p${i % 10}`));
    const out = order([...others, ...focus]);
    expect(out.slice(0, 4)).toEqual(['f0', 'f1', 'f2', 'f3']);
    const perPage = [0, 1, 2, 3, 4].map((p) => out.slice(p * 10, (p + 1) * 10).filter((id) => id.startsWith('f')).length);
    expect(perPage).toEqual([4, 3, 2, 1, 1]);
  });

  it('không còn bài nào hợp luật thì vẫn xếp theo điểm (chỉ đổi chỗ khi có lựa chọn)', () => {
    expect(order([at('n1', 3, 'nt'), at('n2', 2, 'nt'), at('n3', 1, 'nt')])).toEqual(['n1', 'n2', 'n3']);
  });

  it('nới luật trải nghiệm trước luật nơi', () => {
    const xs = [at('a', 5, 'p1', 'exp:an_uong'), at('b', 4, 'p2', 'exp:an_uong'), at('c', 3, 'p3', 'exp:an_uong'), at('d', 2, 'p4', 'exp:bien')];
    expect(order(xs)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('applyFeedPolicy chạy diversify sau các luật theo người xem', () => {
    const xs = [at('n1', 0.9, 'nt'), at('n2', 0.8, 'nt'), at('n3', 0.7, 'nt'), at('d1', 0.1, 'dl')];
    expect(applyFeedPolicy(xs, viewer()).map((x) => x.postId)).toEqual(['n1', 'n2', 'd1', 'n3']);
  });
});
