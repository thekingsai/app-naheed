// Starts the one-time MedStar approval: sends Imran or Salman to MedStar's own sign-in page.
import { getRole, getWho } from '@/lib/session';
import { json } from '@/lib/http';
import { smart, clientId, pkce, REDIRECT, FHIR, SCOPE } from '@/lib/portals/medstar';

export const runtime = 'nodejs';

export async function GET() {
  if ((await getRole()) !== 'family' || !['Imran', 'Salman'].includes(await getWho())) return Response.redirect('https://naheed.thekings.ai/', 302);
  const id = await clientId();
  if (!id) return json({ error: 'MedStar is not registered yet (no client ID saved).' }, 428);
  let s;
  try { s = await smart(); } catch (e) { return json({ error: e.message }, 502); }
  const { verifier, challenge, state } = pkce();
  const url = new URL(s.authorization_endpoint);
  Object.entries({ response_type: 'code', client_id: id, redirect_uri: REDIRECT, scope: SCOPE, aud: FHIR.replace(/\/$/, ''), state, code_challenge: challenge, code_challenge_method: 'S256' })
    .forEach(([k, v]) => url.searchParams.set(k, v));
  const res = new Response(null, { status: 302, headers: { location: url.toString() } });
  res.headers.append('set-cookie', `ms_pkce=${state}.${verifier}; Path=/api/medstar; HttpOnly; Secure; SameSite=Lax; Max-Age=900`);
  return res;
}
