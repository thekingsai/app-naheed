import { getSession, makeSession, cookieOptions, COOKIE } from '@/lib/session';
import { readEncrypted, readPlain } from '@/lib/vault';
import { html } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const s = await getSession();
  const role = s ? s.role : null;
  // Stay signed in until signing out: renew the cookie on every visit.
  const renew = (res) => { if (s) res.headers.append('set-cookie', `${COOKIE}=${makeSession(s.role, s.who)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${cookieOptions.maxAge}`); return res; };
  if (role === 'family') {
    const who = s.who;
    const page = readEncrypted('family.html.enc').toString().replace('</head>', `<script>window.NAHEED_WHO=${JSON.stringify(who || '')}</script></head>`);
    return renew(html(page));
  }
  if (role === 'mom') return renew(html(readEncrypted('mom.html.enc')));
  return html(readPlain('login.html'));
}
