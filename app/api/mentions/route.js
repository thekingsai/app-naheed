import { getRole, getWho } from '@/lib/session';
import { db } from '@/lib/db';
import { json, deny } from '@/lib/http';
export const runtime = 'nodejs';
const PEOPLE = ['Imran', 'Salman'];

// Mentions sent to the signed-in person.
export async function GET() {
  if ((await getRole()) !== 'family') return deny();
  const who = await getWho();
  if (!PEOPLE.includes(who)) return json([]);
  return json(await db('mention_list', { to: who }));
}

// Tag the other person on a message so they read it later.
export async function POST(req) {
  if ((await getRole()) !== 'family') return deny();
  const who = await getWho();
  const { message_id = '', to = '', note = '' } = await req.json().catch(() => ({}));
  if (!PEOPLE.includes(who) || !PEOPLE.includes(to) || to === who) return json({ error: 'Pick Imran or Salman' }, 400);
  if (!/^[0-9a-f-]{36}$/.test(message_id)) return json({ error: 'Bad message' }, 400);
  return json(await db('mention_add', { message_id, from: who, to, note: String(note).slice(0, 300) }));
}
