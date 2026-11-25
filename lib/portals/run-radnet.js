// Runs one RadNet check on the server: signs in with the saved login, brings in new reports as uploads,
// has the AI Doctors read them, and logs the run. Used by the "Check now" button and the nightly check.
import { db } from '@/lib/db';
import { readUpload } from '@/lib/reader';
import { src } from '@/lib/share';
import { radnetCheck } from '@/lib/portals/radnet';

export async function runRadnet(who) {
  // reports already in her record or already brought in
  const { r } = src();
  const known = new Set(Object.keys(r.pdf?.radnet || {}));
  for (const list of Object.values(r.radnet || {})) for (const x of list) if (x.acc && !/report becomes available/i.test(x.text || '')) known.add(String(x.acc));
  let seen = [];
  try { seen = await db('portal_items', { source: 'radnet' }); } catch {}
  for (const x of seen) if (x.status === 'added') known.add(x.key);

  let out;
  try { out = await radnetCheck({ known }); } catch (e) { out = { ok: false, error: 'The RadNet check failed: ' + (e?.message || 'unknown error') }; }
  const added = [], pending = [];
  if (out.ok) {
    const key = process.env.ANTHROPIC_API_KEY;
    for (const x of out.results) {
      if (x.status === 'pending') { pending.push(x.label); await db('portal_item_set', { source: 'radnet', key: x.acc, title: x.label, status: 'pending' }).catch(() => {}); continue; }
      if (x.status !== 'new' && x.status !== 'report-text-only') continue;
      const isPdf = x.status === 'new';
      const data = isPdf ? x.pdf : Buffer.from(`${x.label}\n\n${x.text}`).toString('base64');
      const up = await db('upload_add', { name: `RadNet report · ${x.label}.${isPdf ? 'pdf' : 'txt'}`.slice(0, 200), mime: isPdf ? 'application/pdf' : 'text/plain', size: Buffer.from(data, 'base64').length, data, note: 'Brought in automatically from the RadNet portal', by: who, status: 'new' });
      await db('portal_item_set', { source: 'radnet', key: x.acc, title: x.label, status: 'added', upload_id: up.id });
      added.push({ label: x.label, upload_id: up.id });
      // the AI Doctors read it straight away; it then waits for a "Yes, this is right" like any upload
      if (key) {
        try {
          await db('upload_set', { id: up.id, status: 'reading', error: '' });
          const rd = await readUpload({ key, mime: isPdf ? 'application/pdf' : 'text/plain', data, today: new Date().toDateString() });
          await db('upload_set', rd.error ? { id: up.id, status: 'failed', error: rd.error } : { id: up.id, status: 'review', ai: rd.ai, error: '' });
        } catch (e) { await db('upload_set', { id: up.id, status: 'failed', error: e?.message || 'read failed' }).catch(() => {}); }
      }
    }
  }
  const summary = out.ok ? { exams: out.exams, added: added.map((a) => a.label), pending, checked: out.results.length } : { error: out.error, hint: out.hint };
  if (!out.ok) console.error('[sync radnet]', out.error, out.hint || '');
  await db('portal_run_add', { source: 'radnet', by: who, ok: !!out.ok, summary }).catch(() => {});
  return { ok: !!out.ok, ...summary, added };
}
