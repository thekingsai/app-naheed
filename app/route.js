import { getRole } from '@/lib/session';
import { readEncrypted, readPlain } from '@/lib/vault';
import { html } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const role = await getRole();
  if (role === 'family') return html(readEncrypted('family.html.enc'));
  if (role === 'mom') return html(readEncrypted('mom.html.enc'));
  return html(readPlain('login.html'));
}
