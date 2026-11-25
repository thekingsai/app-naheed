// Nightly RadNet check (Vercel Cron). Also lets the family's assistant start a check on request.
// Needs CRON_SECRET: Vercel sends it as "Authorization: Bearer <secret>"; a manual call can pass ?key=<secret>.
import crypto from 'crypto';
import { json } from '@/lib/http';
import { runRadnet } from '@/lib/portals/run-radnet';

export const runtime = 'nodejs';
export const maxDuration = 300;

function allowed(req) {
  const want = process.env.CRON_SECRET || '';
  if (want.length < 32) return false;
  const got = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || new URL(req.url).searchParams.get('key') || '';
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function GET(req) {
  if (!allowed(req)) return json({ error: 'not allowed' }, 401);
  const manual = new URL(req.url).searchParams.has('key');
  return json(await runRadnet(manual ? 'Assistant check' : 'Nightly check'));
}
