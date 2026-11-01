import crypto from 'node:crypto';
import { getRole, getWho } from '@/lib/session';
import { db } from '@/lib/db';
import { json, deny } from '@/lib/http';
import { cleanItems, itemLabel } from '@/lib/share';

export const runtime = 'nodejs';

export async function GET() {
  if ((await getRole()) !== 'family') return deny();
  try {
    const list = await db('share_list', {});
    return json(list.map((s) => ({ ...s, labels: (s.items || []).map(itemLabel).filter(Boolean) })));
  } catch { return json([]); }
}

export async function POST(req) {
  if ((await getRole()) !== 'family') return deny();
  const who = await getWho();
  if (!['Imran', 'Salman'].includes(who)) return json({ error: { message: 'Only Imran or Salman can share records.' } }, 403);
  const { items = [], ai = false, note = '' } = await req.json().catch(() => ({}));
  const clean = cleanItems(items);
  if (!clean.length) return json({ error: { message: 'Pick at least one result to share.' } }, 400);
  const token = crypto.randomBytes(18).toString('base64url');
  await db('share_add', { token, items: clean, ai: !!ai, note: String(note || '').slice(0, 600), by: who });
  const u = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') || u.host;
  return json({ token, url: `https://${host}/s/${token}`, labels: clean.map(itemLabel) });
}
