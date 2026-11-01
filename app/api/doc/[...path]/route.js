import { getRole } from '@/lib/session';
import { readEncrypted, docFile, exists, readImage, originOf, IMG_PATH } from '@/lib/vault';
import { deny } from '@/lib/http';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  if ((await getRole()) !== 'family') return deny();
  const rel = (await params).path.join('/');
  const name = rel.split('/').pop();
  if (rel.includes('..')) return new Response('Not found', { status: 404 });
  if (IMG_PATH.test(rel)) {
    const img = await readImage(rel, originOf(req));
    if (!img) return new Response('Not found', { status: 404 });
    // scan images never change, so the browser can keep them while flipping through slices
    return new Response(img, { headers: { 'content-type': 'image/jpeg', 'content-disposition': `inline; filename="${name}"`, 'cache-control': 'private, max-age=604800, immutable' } });
  }
  const f = docFile(rel);
  if (!/^[\w\-./]+\.pdf$/.test(rel) || !exists(f)) return new Response('Not found', { status: 404 });
  return new Response(readEncrypted(f), { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${name}"`, 'cache-control': 'private, no-store' } });
}
