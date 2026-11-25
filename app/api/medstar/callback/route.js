// MedStar sends the family back here after approving; swaps the one-time code for the long-lived pass.
import { cookies } from 'next/headers';
import { getRole } from '@/lib/session';
import { smart, clientId, saveGrant, REDIRECT } from '@/lib/portals/medstar';

export const runtime = 'nodejs';
const back = (msg) => new Response(null, { status: 302, headers: { location: 'https://naheed.thekings.ai/?medstar=' + encodeURIComponent(msg), 'set-cookie': 'ms_pkce=; Path=/api/medstar; HttpOnly; Secure; SameSite=Lax; Max-Age=0' } });

export async function GET(req) {
  if ((await getRole()) !== 'family') return back('please sign in to AiHealth first');
  const u = new URL(req.url), code = u.searchParams.get('code'), state = u.searchParams.get('state');
  if (u.searchParams.get('error')) return back(u.searchParams.get('error_description') || u.searchParams.get('error'));
  const saved = (await cookies()).get('ms_pkce')?.value || '';
  const [want, verifier] = saved.split('.');
  if (!code || !state || !want || state !== want) return back('the approval expired, please try again');
  try {
    const s = await smart();
    const r = await fetch(s.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: await clientId(), code_verifier: verifier }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return back(j.error_description || j.error || 'MedStar refused the code');
    await saveGrant(j);
    return back('ok');
  } catch (e) { return back(e?.message || 'connection failed'); }
}
