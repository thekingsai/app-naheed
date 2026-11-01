import { getRole, getWho } from '@/lib/session';
import { db } from '@/lib/db';
import { json, deny } from '@/lib/http';
export const runtime = 'nodejs';

// The person who uploaded the file says whether the reading is accurate.
export async function POST(req, { params }) {
  const role = await getRole();
  if (!role) return deny();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Bad id' }, 400);
  const { ok = false, feedback = '' } = await req.json().catch(() => ({}));
  const by = (await getWho()) || (role === 'mom' ? 'Naheed' : 'Family');
  const r = await db('upload_confirm', { id, by, ok: !!ok, feedback: String(feedback).slice(0, 1000) });
  return json(r || {});
}
