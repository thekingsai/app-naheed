import { getRole } from '@/lib/session';
import { db } from '@/lib/db';
import { json, deny } from '@/lib/http';
export const runtime = 'nodejs';
export async function GET() {
  if ((await getRole()) !== 'family') return deny();
  return json(await db('chat_list', { limit: 40 }));
}
