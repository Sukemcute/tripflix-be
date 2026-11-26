/**
 * Gom theo khoá, giữ thứ tự xuất hiện. O(N): push vào mảng sẵn có; chép lại mảng mỗi phần tử (`[...old, x]`) là O(N²)
 * và từng chặn event loop hàng giây khi một người có hàng chục nghìn dòng.
 */
export function groupBy<T, K>(xs: Iterable<T>, keyOf: (x: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const x of xs) {
    const key = keyOf(x);
    const group = groups.get(key);
    if (group) group.push(x);
    else groups.set(key, [x]);
  }
  return groups;
}
