import { getRole, getWho } from '@/lib/session';
import { db } from '@/lib/db';
import { json, deny } from '@/lib/http';
export const runtime = 'nodejs';
const MAX = 20 * 1024 * 1024;   // whole file
const PART = 3.5 * 1024 * 1024; // each piece stays under the host's 4.5 MB request limit

export async function POST(req) {
  const role = await getRole();
  if (!role) return deny();
  const by = (await getWho()) || (role === 'mom' ? 'Naheed' : 'Family');
  const u = new URL(req.url); const step = u.searchParams.get('step');
  if (step === 'begin') {
    const { name = '', mime = '', size = 0 } = await req.json().catch(() => ({}));
    if (!name || !(size > 0)) return json({ error: 'Missing file details' }, 400);
    if (size > MAX) return json({ error: 'File is over 20 MB' }, 413);
    return json(await db('upload_add', { name: String(name).slice(0, 200), mime: mime || 'application/octet-stream', size, data: '', by, status: 'uploading' }));
  }
  if (step === 'part' || step === 'finish') {
    const id = u.searchParams.get('id') || '';
    if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Bad id' }, 400);
    if (step === 'finish') return json(await db('upload_finish', { id, by }));
    const buf = Buffer.from(await req.arrayBuffer());
    if (!buf.length || buf.length > PART) return json({ error: 'Bad piece' }, 400);
    return json(await db('upload_append', { id, by, data: buf.toString('base64') }));
  }
  const f = (await req.formData()).get('file');
  if (!f || typeof f === 'string') return json({ error: 'No file' }, 400);
  if (f.size > MAX) return json({ error: 'File is over 20 MB' }, 413);
  const data = Buffer.from(await f.arrayBuffer()).toString('base64');
  return json(await db('upload_add', { name: f.name.slice(0, 200), mime: f.type || 'application/octet-stream', size: f.size, data, by }));
}

export async function GET() {
  const role = await getRole();
  if (!role) return deny();
  if (role === 'mom') return json(await db('upload_list', { by: 'Naheed' }));
  return json(await db('upload_list', {}));
}
