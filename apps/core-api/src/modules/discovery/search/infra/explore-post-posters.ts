type Page<T> = { items: T[]; nextCursor: string | null };
type PostWithMedia = { postType: string; mediaIds: string[] };
type GetPlayback = (assetIds: string[]) => Promise<Record<string, { posters: { w360: string } }>>;

/**
 * Gắn `posterUrl` cho bài video: poster 360 của video đầu tiên phát được (giống thẻ feed).
 * Bài không phải video, hoặc video chưa sẵn sàng, nhận null. Chỉ đọc media khi trang có video.
 */
export async function withVideoPosters<T extends PostWithMedia>(
  page: Page<T>,
  getPlayback: GetPlayback,
): Promise<Page<T & { posterUrl: string | null }>> {
  const ids = page.items.filter((p) => p.postType === 'video').flatMap((p) => p.mediaIds);
  const playback = ids.length ? await getPlayback([...new Set(ids)]) : {};
  return {
    ...page,
    items: page.items.map((post) => {
      const assetId = post.postType === 'video' ? post.mediaIds.find((id) => playback[id]) : undefined;
      return { ...post, posterUrl: assetId ? playback[assetId]!.posters.w360 : null };
    }),
  };
}
