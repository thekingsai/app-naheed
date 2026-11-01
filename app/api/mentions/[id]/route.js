import { getRole, getWho } from '@/lib/session';
import { db } from '@/lib/db';
import { json, deny } from '@/lib/http';
export const runtime = 'nodejs';

// Mark a mention as read (id "all" marks every mention on that message as read).
export async function POST(req, { params }) {
  if ((await getRole()) !== 'family') return deny();
  const who = await getWho();
  const { id } = await params;
  const { message_id = '' } = await req.json().catch(() => ({}));
  if (id !== 'all' && !/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Bad id' }, 400);
  return json(await db('mention_read', { to: who, id: id === 'all' ? '' : id, message_id: /^[0-9a-f-]{36}$/.test(message_id) ? message_id : '' }));
}
