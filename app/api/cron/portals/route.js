// Nightly portal check (Vercel Cron): RadNet with the saved login, MedStar with the approved pass.
// Running MedStar daily also keeps its pass alive (Oracle drops passes unused for 3 months).
// Needs CRON_SECRET in Vercel: Vercel sends it as "Authorization: Bearer <secret>".
import crypto from 'node:crypto';
import { json } from '@/lib/http';
import { runRadnet } from '@/lib/portals/run-radnet';
import { runMedstar, grant } from '@/lib/portals/medstar';

export const runtime = 'nodejs';
export const maxDuration = 800;

function allowed(req) {
  const want = process.env.CRON_SECRET || '';
  if (want.length < 16) return false;
  const got = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function GET(req) {
  if (!allowed(req)) return json({ error: 'not allowed' }, 401);
  const out = {};
  if (process.env.RADNET_USER && process.env.RADNET_PASS) out.radnet = await runRadnet('Nightly check');
  if (await grant()) out.medstar = await runMedstar('Nightly check');
  return json(out);
}
