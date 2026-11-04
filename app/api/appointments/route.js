// Her appointments: MedStar visits come with the page; anything Imran or Salman adds, edits or removes is kept here.
import { getRole, getWho } from '@/lib/session';
import { db } from '@/lib/db';
import { json, deny } from '@/lib/http';
export const runtime = 'nodejs';

const S = (v, n = 300) => String(v ?? '').slice(0, n);
const editor = async () => ((await getRole()) === 'family' ? (await getWho()) || 'Family' : null);

export async function GET() {
  if (!(await getRole())) return deny();
  try { return json(await db('appt_list', {})); } catch { return json([]); }
}

export async function POST(req) {
  const by = await editor();
  if (!by) return deny();
  const a = await req.json().catch(() => ({}));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date || '') || !S(a.kind).trim()) return json({ error: 'Please add the kind of visit and the date.' }, 400);
  if (a.time && !/^\d{2}:\d{2}$/.test(a.time)) return json({ error: 'Bad time' }, 400);
  if (a.id && !/^[0-9a-f-]{36}$/.test(a.id)) return json({ error: 'Bad id' }, 400);
  const row = {
    id: a.id || '', visit_key: a.id ? '' : S(a.visit_key, 40), date: a.date, time: a.time || '', kind: S(a.kind, 60), place: S(a.place, 200),
    reason: S(a.reason, 300), mode: ['In person', 'Video', 'Phone'].includes(a.mode) ? a.mode : 'In person', phone: S(a.phone, 40),
    bring: S(a.bring, 300), notes: S(a.notes, 1000), ask: a.ask !== false, by,
  };
  return json(await db('appt_set', row));
}

export async function DELETE(req) {
  const by = await editor();
  if (!by) return deny();
  const { id = '', visit_key = '', date = '', kind = '' } = await req.json().catch(() => ({}));
  if (id && !/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Bad id' }, 400);
  if (!id && !visit_key) return json({ error: 'Nothing to remove' }, 400);
  return json(await db('appt_delete', id ? { id, by } : { visit_key: S(visit_key, 40), date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '', kind: S(kind, 60), by }));
}
