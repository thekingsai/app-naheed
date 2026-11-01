import { getRole } from '@/lib/session';
import { db } from '@/lib/db';
import { deny } from '@/lib/http';
export const runtime = 'nodejs';
export async function GET(req, { params }) {
  if ((await getRole()) !== 'family') return deny();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  const r = await db('upload_get', { id });
  if (!r) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(r.data, 'base64'), { headers: { 'content-type': r.mime, 'content-disposition': `inline; filename="${encodeURIComponent(r.name)}"`, 'cache-control': 'private, no-store' } });
}
