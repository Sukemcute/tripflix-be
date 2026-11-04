export interface CursorPayload {
  createdAt: string;
  id: string;
}

export function encodeCursor(createdAt: Date, id: string): string {
  const payload: CursorPayload = {
    createdAt: createdAt.toISOString(),
    id,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(cursor?: string): { createdAt: Date; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as CursorPayload;
    if (!parsed.createdAt || !parsed.id) return undefined;
    return {
      createdAt: new Date(parsed.createdAt),
      id: parsed.id,
    };
  } catch {
    return undefined;
  }
}
