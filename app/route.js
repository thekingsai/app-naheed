import { getRole, getWho } from '@/lib/session';
import { readEncrypted, readPlain } from '@/lib/vault';
import { html } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const role = await getRole();
  if (role === 'family') {
    const who = await getWho();
    const page = readEncrypted('family.html.enc').toString().replace('</head>', `<script>window.NAHEED_WHO=${JSON.stringify(who || '')}</script></head>`);
    return html(page);
  }
  if (role === 'mom') return html(readEncrypted('mom.html.enc'));
  return html(readPlain('login.html'));
}
