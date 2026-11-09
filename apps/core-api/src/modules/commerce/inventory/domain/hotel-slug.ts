import { createHash } from 'node:crypto';

const SUFFIX_LENGTH = 4;
const MAX_NAME_LENGTH = 60;

const slugifyName = (name: string) =>
  name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_NAME_LENGTH)
    .replace(/^-+|-+$/g, '');

/** Slug từ tên và hash của id: seed lại vẫn ra đúng slug cũ, không suy ra được từ số thứ tự. */
export function buildHotelSlug(id: string, name: string): string {
  const suffix = createHash('sha256').update(`tripflix-hotel-slug:${id}`).digest('base64url').replace(/[-_]/g, 'x').toLowerCase().slice(0, SUFFIX_LENGTH);
  return [slugifyName(name), suffix].filter(Boolean).join('-');
}
