import { getRole } from '@/lib/session';
import { readEncrypted, docFile, exists } from '@/lib/vault';
import { deny } from '@/lib/http';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  if ((await getRole()) !== 'family') return deny();
  const rel = (await params).path.join('/');
  const f = docFile(rel);
  const isPdf = /^[\w\-./]+\.pdf$/.test(rel), isImg = /^radnet\/images\/[\w\-.]+\/[\w\-.]+\.jpg$/.test(rel);
  if ((!isPdf && !isImg) || rel.includes('..') || !exists(f)) return new Response('Not found', { status: 404 });
  const name = rel.split('/').pop();
  return new Response(readEncrypted(f), { headers: {
    'content-type': isPdf ? 'application/pdf' : 'image/jpeg',
    'content-disposition': `inline; filename="${name}"`,
    // scan images never change, so the browser can keep them while flipping through slices
    'cache-control': isPdf ? 'private, no-store' : 'private, max-age=86400',
  } });
}
