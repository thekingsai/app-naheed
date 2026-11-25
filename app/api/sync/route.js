// "Check her portals": signs in to each portal on the server with the saved login and brings in anything new.
// New reports go through the same path as uploads: the AI Doctors read them, then Imran or Salman confirms.
import { getRole, getWho } from '@/lib/session';
import { db } from '@/lib/db';
import { json, deny } from '@/lib/http';
import { runRadnet } from '@/lib/portals/run-radnet';
import { runMedstar, grant, clientId } from '@/lib/portals/medstar';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET() {
  if ((await getRole()) !== 'family') return deny();
  try {
    const [runs, items] = await Promise.all([db('portal_runs', {}), db('portal_items', {})]);
    const ms = (await grant().catch(() => null)) ? true : (await clientId().catch(() => '')) ? 'connect' : false;
    return json({ runs, items, ready: { radnet: !!(process.env.RADNET_USER && process.env.RADNET_PASS), medstar: ms, labcorp: false } });
  } catch { return json({ runs: [], items: [], ready: {} }); }
}

export async function POST(req) {
  if ((await getRole()) !== 'family') return deny();
  const who = await getWho();
  if (!['Imran', 'Salman'].includes(who)) return json({ error: { message: 'Only Imran or Salman can check the portals.' } }, 403);
  const { source = 'radnet' } = await req.json().catch(() => ({}));
  if (source === 'medstar') return json(await runMedstar(who));
  if (source !== 'radnet') return json({ error: { message: 'Labcorp can\'t be checked automatically.' } }, 400);
  return json(await runRadnet(who));

}
