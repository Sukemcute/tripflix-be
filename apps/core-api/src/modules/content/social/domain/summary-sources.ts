/** Thu thập các ID trích dẫn ở content/safety; không đọc văn bản để suy đoán nguồn. */
export function collectCitationIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectCitationIds);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const ids = Array.isArray(record.commentIds)
    ? record.commentIds.filter((id): id is string => typeof id === 'string')
    : [];
  return [
    ...ids,
    ...Object.entries(record)
      .filter(([key]) => key !== 'commentIds')
      .flatMap(([, child]) => collectCitationIds(child)),
  ];
}
export function filterCitations(value: unknown, visibleIds: Set<string>): unknown {
  if (Array.isArray(value))
    return value.map((child) => filterCitations(child, visibleIds)).filter((child) => child !== null);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (
    Array.isArray(record.commentIds) &&
    record.commentIds.some((id) => typeof id !== 'string' || !visibleIds.has(id))
  )
    return null;
  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => [
      key,
      key === 'commentIds' ? child : filterCitations(child, visibleIds),
    ]),
  );
}
