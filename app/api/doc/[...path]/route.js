import { getRole } from '@/lib/session';
import { readEncrypted, docFile, exists } from '@/lib/vault';
import { deny } from '@/lib/http';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  if ((await getRole()) !== 'family') return deny();
  const rel = (await params).path.join('/');
  const f = docFile(rel);
  if (!/^[\w\-./]+\.pdf$/.test(rel) || !exists(f)) return new Response('Not found', { status: 404 });
  const name = rel.split('/').pop();
  return new Response(readEncrypted(f), { headers: {
    'content-type': 'application/pdf',
    'content-disposition': `inline; filename="${name}"`,
    'cache-control': 'private, no-store',
  } });
}
