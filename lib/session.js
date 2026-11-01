import crypto from 'node:crypto';
import { cookies } from 'next/headers';

const NAME = 'nh_session';
const DAYS = 400; // browsers cap cookies at about 400 days; the cookie is renewed on every visit
const secret = () => process.env.SESSION_SECRET || '';

function sign(v) { return crypto.createHmac('sha256', secret()).update(v).digest('base64url'); }

export function makeSession(role, who = '') {
  const v = Buffer.from(JSON.stringify({ role, who, iat: Date.now() })).toString('base64url');
  return `${v}.${sign(v)}`;
}

export async function getRole() {
  const s = await getSession();
  return s ? s.role : null;
}

export async function getWho() {
  const s = await getSession();
  return s ? s.who : '';
}

export async function getSession() {
  const c = (await cookies()).get(NAME)?.value;
  if (!c || !secret()) return null;
  const [v, s] = c.split('.');
  if (!v || !s) return null;
  const good = sign(v);
  if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(v, 'base64url').toString());
    if (p.role !== 'family' && p.role !== 'mom') return null;
    const who = ['Imran', 'Salman', 'Naheed'].includes(p.who) ? p.who : (p.role === 'mom' ? 'Naheed' : '');
    return { role: p.role, who };
  } catch { return null; }
}

export const cookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: DAYS * 86400 };
export const COOKIE = NAME;
