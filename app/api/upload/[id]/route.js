import { getRole, getWho } from '@/lib/session';
import { db } from '@/lib/db';
import { json, deny } from '@/lib/http';
export const runtime = 'nodejs';
const ok = (id) => /^[0-9a-f-]{36}$/.test(id);

export async function GET(req, { params }) {
  const role = await getRole();
  if (!role) return deny();
  const { id } = await params;
  if (!ok(id)) return new Response('Not found', { status: 404 });
  const r = await db('upload_get', { id });
  if (!r || (role === 'mom' && r.uploaded_by !== 'Naheed')) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(r.data, 'base64'), { headers: { 'content-type': r.mime, 'content-disposition': `inline; filename="${encodeURIComponent(r.name)}"`, 'cache-control': 'private, no-store' } });
}

// Only the person who uploaded a file can remove it.
export async function DELETE(req, { params }) {
  const role = await getRole();
  if (!role) return deny();
  const { id } = await params;
  if (!ok(id)) return json({ error: 'Bad id' }, 400);
  const by = (await getWho()) || (role === 'mom' ? 'Naheed' : 'Family');
  return json(await db('upload_delete', { id, by }));
}
