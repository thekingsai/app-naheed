import { COOKIE } from '@/lib/session';
import { json } from '@/lib/http';
export async function POST() {
  const res = json({ ok: true });
  res.headers.append('set-cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return res;
}
