import crypto from 'node:crypto';
import { cookies } from 'next/headers';

const NAME = 'nh_session';
const DAYS = 30;
const secret = () => process.env.SESSION_SECRET || '';

function sign(v) { return crypto.createHmac('sha256', secret()).update(v).digest('base64url'); }

export function makeSession(role) {
  const v = Buffer.from(JSON.stringify({ role, iat: Date.now() })).toString('base64url');
  return `${v}.${sign(v)}`;
}

export async function getRole() {
  const c = (await cookies()).get(NAME)?.value;
  if (!c || !secret()) return null;
  const [v, s] = c.split('.');
  if (!v || !s) return null;
  const good = sign(v);
  if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(v, 'base64url').toString());
    if (Date.now() - p.iat > DAYS * 864e5) return null;
    return p.role === 'family' || p.role === 'mom' ? p.role : null;
  } catch { return null; }
}

export const cookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: DAYS * 86400 };
export const COOKIE = NAME;
