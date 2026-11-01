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
  const role = same(p, process.env.PW_FAMILY_SHA256 || '') ? 'family' : same(p, process.env.PW_MOM_SHA256 || '') ? 'mom' : null;
  try { await db('login_record', { ip, ok: !!role, role }); } catch {}
  if (!role) return json({ error: 'That password didn’t work.' }, 401);
  const res = json({ ok: true });
  res.headers.append('set-cookie', `${COOKIE}=${makeSession(role)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${cookieOptions.maxAge}`);
  return res;
}
