import crypto from 'node:crypto';
import { headers } from 'next/headers';
import { makeSession, cookieOptions, COOKIE } from '@/lib/session';
import { db } from '@/lib/db';
import { json } from '@/lib/http';

export const runtime = 'nodejs';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function POST(req) {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  let fails = 0;
  try { fails = (await db('login_failures', { ip })).n; } catch {}
  if (fails >= 10) return json({ error: 'Too many tries. Please wait 15 minutes.' }, 429);
  const { password = '' } = await req.json().catch(() => ({}));
  const p = sha(String(password).trim());
  // Each person has their own password, so Ask AI knows who asked.
  const USERS = [
    { who: 'Imran', role: 'family', hash: process.env.PW_IMRAN_SHA256 || 'e378432fc68f9b707bd923e7968c1524c57e91ffc62a89b5a29bbb2473a65979' },
    { who: 'Salman', role: 'family', hash: process.env.PW_SALMAN_SHA256 || '13aacf62bf7029566aa6488bd4722075f9c8a3fa3e63ae018819998ff619e409' },
    { who: 'Naheed', role: 'mom', hash: process.env.PW_MOM_SHA256 || '' },
  ];
  const user = USERS.find((u) => u.hash && same(p, u.hash));
  const role = user ? user.role : null;
  try { await db('login_record', { ip, ok: !!role, role }); } catch {}
  if (!role) return json({ error: 'That password didn’t work.' }, 401);
  const res = json({ ok: true });
  res.headers.append('set-cookie', `${COOKIE}=${makeSession(role, user && user.who)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${cookieOptions.maxAge}`);
  return res;
}
