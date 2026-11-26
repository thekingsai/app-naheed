// "New since you were last here": remembers when each person (Imran, Salman, Naheed) last opened the app
// and lists the documents that arrived after their previous visit.
import { getRole, getWho } from '@/lib/session';
import { db } from '@/lib/db';
import { json, deny } from '@/lib/http';
export const runtime = 'nodejs';

const GAP = 30 * 60 * 1000; // a visit within 30 minutes of the last one counts as the same visit

const origin = (u) => /^MedStar/.test(u.name) ? 'MedStar' : /^RadNet/.test(u.name) ? 'RadNet' : /^Labcorp/i.test(u.name) ? 'Labcorp' : 'Uploaded by ' + u.uploaded_by;

export async function GET() {
  const role = await getRole();
  if (!role) return deny();
  const who = (await getWho()) || (role === 'mom' ? 'Naheed' : 'Family');
  const k = 'seen:' + who, now = Date.now();
  let st = {};
  try { st = JSON.parse((await db('kv_get', { key: k }))?.value || '{}'); } catch {}
  if (!st.last || now - Date.parse(st.last) > GAP) { st = { prev: st.last || null, last: new Date(now).toISOString() }; await db('kv_set', { key: k, value: JSON.stringify(st) }).catch(() => {}); }
  else { st.last = new Date(now).toISOString(); await db('kv_set', { key: k, value: JSON.stringify(st) }).catch(() => {}); }
  const since = st.prev;
  if (!since) return json({ who, since: null, items: [] });
  let list = [];
  try { list = await db('upload_list', {}); } catch {}
  const items = list.filter((u) => u.created_at > since && ['confirmed', 'review', 'flagged'].includes(u.status) && (role !== 'mom' || u.status === 'confirmed'))
    .map((u) => ({ id: u.id, title: u.ai?.title || u.name, kind: u.ai?.kind || '', date: u.ai?.date || '', plain: role === 'mom' ? (u.ai?.plain || '') : '', from: origin(u), at: u.created_at }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return json({ who, since, items });
}
