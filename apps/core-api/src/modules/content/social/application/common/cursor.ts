export interface CursorPayload {
  createdAt?: string;
  updatedAt?: string;
  id: string;
  total?: number;
}

/**
 * total (tuỳ chọn): tổng đã đếm ở trang đầu, mang theo để các trang sau khỏi đếm lại.
 * Cursor do client gửi lại nên total chỉ dùng để hiển thị, không dùng cho quyết định nào khác.
 */
export function encodeCursor(createdAt: Date, id: string, total?: number): string {
  const payload: CursorPayload = {
    createdAt: createdAt.toISOString(),
    id,
    ...(total !== undefined ? { total } : {}),
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(cursor?: string): { createdAt: Date; id: string; total?: number } | undefined {
  if (!cursor) return undefined;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as CursorPayload;
    if (!parsed.createdAt || !parsed.id) return undefined;
    return {
      createdAt: new Date(parsed.createdAt),
      id: parsed.id,
      // Cursor cũ không có total, hoặc total sai kiểu: trang đó đếm lại như trước.
      ...(Number.isInteger(parsed.total) && (parsed.total as number) >= 0 ? { total: parsed.total } : {}),
    };
  } catch {
    return undefined;
  }
}

export function encodeSyncCursor(updatedAt: Date, id: string): string {
  const payload: CursorPayload = {
    updatedAt: updatedAt.toISOString(),
    id,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeSyncCursor(cursor?: string): { updatedAt: Date; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as CursorPayload;
    const ts = parsed.updatedAt ?? parsed.createdAt;
    if (!ts || !parsed.id) return undefined;
    return {
      updatedAt: new Date(ts),
      id: parsed.id,
    };
  } catch {
    return undefined;
  }
}
