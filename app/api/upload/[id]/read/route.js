import { getRole } from '@/lib/session';
import { db } from '@/lib/db';
import { json, deny } from '@/lib/http';
import { readUpload } from '@/lib/reader';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req, { params }) {
  const role = await getRole();
  if (!role) return deny();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Bad id' }, 400);
  const key = process.env.ANTHROPIC_API_KEY || req.headers.get('x-anthropic-key') || '';
  if (!key) { await db('upload_set', { id, status: 'new', error: 'Needs the API key on the server to read files.' }); return json({ status: 'new', error: 'needs key' }, 428); }
  const f = await db('upload_get', { id });
  if (!f || (role === 'mom' && f.uploaded_by !== 'Naheed')) return json({ error: 'Not found' }, 404);
  if (f.status === 'uploading') return json({ error: 'Still uploading' }, 409);
  await db('upload_set', { id, status: 'reading', error: '' });
  const r = await readUpload({ key, mime: f.mime, data: f.data, today: new Date().toDateString() });
  if (r.error) { await db('upload_set', { id, status: 'failed', error: r.error }); return json({ status: 'failed', error: r.error }); }
  await db('upload_set', { id, status: 'review', ai: r.ai, error: '' });
  return json({ status: 'review', ai: r.ai });
}
