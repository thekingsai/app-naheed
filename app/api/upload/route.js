import { getRole } from '@/lib/session';
import { db } from '@/lib/db';
import { json, deny } from '@/lib/http';
export const runtime = 'nodejs';
const MAX = 15 * 1024 * 1024;
export async function POST(req) {
  const role = await getRole();
  if (!role) return deny();
  const f = (await req.formData()).get('file');
  if (!f || typeof f === 'string') return json({ error: 'No file' }, 400);
  if (f.size > MAX) return json({ error: 'File is over 15 MB' }, 413);
  const data = Buffer.from(await f.arrayBuffer()).toString('base64');
  const r = await db('upload_add', { name: f.name.slice(0, 200), mime: f.type || 'application/octet-stream', size: f.size, data, by: role === 'mom' ? 'Naheed' : 'Family' });
  return json(r);
}
export async function GET() {
  if ((await getRole()) !== 'family') return deny();
  return json(await db('upload_list', {}));
}
