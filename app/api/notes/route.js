import { getRole } from '@/lib/session';
import { db } from '@/lib/db';
import { json, deny } from '@/lib/http';
export const runtime = 'nodejs';
export async function GET() {
  if ((await getRole()) !== 'family') return deny();
  return json(await db('notes_list', {}));
}
export async function POST(req) {
  if ((await getRole()) !== 'family') return deny();
  const { actions = [] } = await req.json();
  const ok = actions.filter((a) => ['confirm', 'dismiss', 'resolve'].includes(a.op) && /^[0-9a-f-]{36}$/.test(a.id));
  return json(await db('notes_apply', { actions: ok }));
}
