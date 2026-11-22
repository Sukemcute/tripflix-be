import '../../../../platform/load-env.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { loadEnv } from '@tripflix/config';
import { ObjectNotFoundError, S3ObjectStorage } from '@tripflix/storage';
import { coreEnvSchema } from '../../../../platform/env.js';
import { HOTEL_IMAGE_KEY_ROOT } from './image-keys.js';
import { CATALOG_SEED_FILE } from './seed-catalog.js';
import { loadReviewPhotos } from './seed-reviews.js';

// Tải ảnh khách sạn giả lập lên S3 một lần: node dist/modules/commerce/db/seed/upload-hotel-images.js <thư mục images> [--check]
// Khoá: <S3_KEY_PREFIX>images/hotels/<đường dẫn sau /images/>. Ảnh đã có cùng kích thước thì bỏ qua, nên chạy lại được.
// --check: chỉ ghi và đọc lại một file nhỏ để thử key AWS, không tải ảnh.
const CONTENT_TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const CONCURRENCY = 8;

const env = loadEnv(coreEnvSchema);
const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const sourceDir = args.find((a) => !a.startsWith('--'));
const storage = new S3ObjectStorage({ region: env.AWS_REGION, bucket: env.S3_MEDIA_BUCKET, keyPrefix: env.S3_KEY_PREFIX, cdnBaseUrl: env.MEDIA_CDN_URL ?? '' });

function listFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) listFiles(path, out);
    else if (CONTENT_TYPES[extname(name).toLowerCase()]) out.push(path);
  }
  return out;
}

async function isUploaded(key: string, size: number): Promise<boolean> {
  try {
    return (await storage.getObjectSizeBytes(key)) === size;
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return false;
    throw error;
  }
}

async function check() {
  const key = storage.resolveKey(`${HOTEL_IMAGE_KEY_ROOT}/_check.txt`);
  const body = new TextEncoder().encode(`check ${new Date().toISOString()}`);
  await storage.putObject({ key, body, contentType: 'text/plain' });
  const size = await storage.getObjectSizeBytes(key);
  process.stdout.write(`S3 ok: ghi và đọc lại ${key} (${size} byte) trên bucket ${env.S3_MEDIA_BUCKET}, vùng ${env.AWS_REGION}\n`);
  if (env.MEDIA_CDN_URL) process.stdout.write(`URL CDN: ${storage.getCdnUrl(key)}\n`);
}

/** Ảnh mà danh mục và đánh giá seed thực sự dùng, dạng đường dẫn tương đối trong thư mục images (vinpearl/a.jpg, reviews/room-01.jpg). */
function listCatalogImages(): Set<string> {
  const catalog = JSON.parse(readFileSync(CATALOG_SEED_FILE, 'utf8')) as { hotels: { thumbnail: string | null; images: string[] }[] };
  const reviewImages = loadReviewPhotos().map((photo) => `reviews/${photo.file}`);
  const paths = [...catalog.hotels.flatMap((h) => [h.thumbnail, ...h.images]), ...reviewImages].filter((p): p is string => !!p && !/^https?:\/\//.test(p));
  return new Set(paths.map((p) => p.replace(/^\/?images\//, '')));
}

async function upload(dir: string) {
  // Chỉ tải ảnh danh mục đang dùng; thư mục nguồn có thể chứa ảnh thừa.
  const used = listCatalogImages();
  const files = listFiles(dir).filter((f) => used.has(relative(dir, f).split(sep).join('/')));
  let uploaded = 0;
  let skipped = 0;
  let index = 0;
  const worker = async () => {
    while (index < files.length) {
      const file = files[index++]!;
      const relativePath = relative(dir, file).split(sep).join('/');
      const key = storage.resolveKey(`${HOTEL_IMAGE_KEY_ROOT}/${relativePath}`);
      const body = readFileSync(file);
      if (await isUploaded(key, body.byteLength)) {
        skipped++;
        continue;
      }
      // Ảnh seed không đổi nội dung theo cùng khoá, nên cho CDN giữ lâu.
      await storage.putObject({ key, body, contentType: CONTENT_TYPES[extname(file).toLowerCase()]!, cacheControl: 'public, max-age=31536000, immutable' });
      uploaded++;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write(`Ảnh khách sạn: ${files.length} file, tải mới ${uploaded}, đã có ${skipped}; khoá gốc ${storage.resolveKey(HOTEL_IMAGE_KEY_ROOT)}/\n`);
}

if (flags.includes('--check')) await check();
else if (!sourceDir) {
  process.stderr.write('Dùng: node dist/modules/commerce/db/seed/upload-hotel-images.js <thư mục images> [--check]\n');
  process.exit(1);
} else await upload(sourceDir);
