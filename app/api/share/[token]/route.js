import { getRole, getWho } from '@/lib/session';
import { db } from '@/lib/db';
import { json, deny } from '@/lib/http';

export const runtime = 'nodejs';

// Turns a shared link off. Either brother can turn off any link.
export async function DELETE(req, { params }) {
  if ((await getRole()) !== 'family') return deny();
  const who = await getWho();
  if (!['Imran', 'Salman'].includes(who)) return json({ error: { message: 'Only Imran or Salman can turn links off.' } }, 403);
  const { token } = await params;
  await db('share_revoke', { token, by: who });
  return json({ ok: true });
}
