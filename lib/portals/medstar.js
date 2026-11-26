// MedStar (Oracle Health / Cerner) through the official patient-access API (SMART on FHIR).
// One-time: Imran approves AiHealth on MedStar's own sign-in page. The app keeps the long-lived
// "refresh" pass (encrypted, never the password) and uses it to read her record whenever asked.
import crypto from 'node:crypto';
import { db } from '@/lib/db';
import { readUpload, autoStatus } from '@/lib/reader';

export const FHIR = 'https://fhir-myrecord.cerner.com/r4/c2a9aaad-29f4-4d5d-87b0-388c13a9b433/';
export const REDIRECT = 'https://naheed.thekings.ai/api/medstar/callback';
// Records on file before this date already came in from the MedStar export, so the first pull
// only marks them as seen instead of turning them into uploads.
const BASELINE = '2026-10-27';
const TYPES = ['Patient', 'Encounter', 'DiagnosticReport', 'Observation', 'DocumentReference', 'Binary', 'Appointment',
  'MedicationRequest', 'Condition', 'AllergyIntolerance', 'Procedure', 'Immunization'];
export const SCOPE = ['launch/patient', 'offline_access', ...TYPES.map((t) => `patient/${t}.read`)].join(' ');

/* ---------- small helpers ---------- */
const key = () => Buffer.from(process.env.DATA_KEY || '', 'hex');
export function seal(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}
export function open(b64) {
  const buf = Buffer.from(b64, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function pkce() {
  const verifier = b64url(crypto.randomBytes(48));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), state: b64url(crypto.randomBytes(18)) };
}
export async function clientId() {
  const r = await db('kv_get', { key: 'medstar_client_id' }).catch(() => null);
  return r?.value || process.env.MEDSTAR_CLIENT_ID || '';
}
let SMART = null;
export async function smart() {
  if (SMART) return SMART;
  const r = await fetch(FHIR + '.well-known/smart-configuration', { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`MedStar's sign-in settings didn't load (${r.status})`);
  SMART = await r.json();
  return SMART;
}

/* ---------- tokens ---------- */
export async function saveGrant(tok) {
  if (!tok.refresh_token) throw new Error('MedStar did not give a long-lived pass. Make sure "offline_access" is ticked in the app registration.');
  await db('kv_set', { key: 'medstar_grant', value: seal(JSON.stringify({ refresh: tok.refresh_token, patient: tok.patient || '', scope: tok.scope || '', at: new Date().toISOString() })) });
}
export async function grant() {
  const r = await db('kv_get', { key: 'medstar_grant' }).catch(() => null);
  if (!r?.value) return null;
  try { return { ...JSON.parse(open(r.value)), saved: r.updated_at }; } catch { return null; }
}
async function accessToken(g) {
  const s = await smart(), id = await clientId();
  const r = await fetch(s.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: g.refresh, client_id: id }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const e = new Error('MedStar turned down the saved pass. Reconnect MedStar in the app (one sign-in).');
    e.reconnect = true; e.detail = j.error_description || j.error || r.status; throw e;
  }
  return { token: j.access_token, patient: j.patient || g.patient };
}

/* ---------- reading her record ---------- */
async function getAll(tok, path) {
  const out = [];
  let url = FHIR + path, pages = 0;
  while (url && pages++ < 40) {
    const r = await fetch(url, { headers: { authorization: 'Bearer ' + tok, accept: 'application/fhir+json' } });
    if (r.status === 403 || r.status === 404) return out; // resource not shared by this site
    if (!r.ok) throw new Error(`${path.split('?')[0]} ${r.status}`);
    const b = await r.json();
    for (const e of b.entry || []) if (e.resource && e.resource.resourceType !== 'OperationOutcome') out.push(e.resource);
    url = (b.link || []).find((l) => l.relation === 'next')?.url || '';
  }
  return out;
}
async function binary(tok, ref, want) {
  const url = /^https?:/.test(ref) ? ref : FHIR + ref.replace(/^\//, '');
  const tried = [];
  for (const accept of [...new Set([...want, 'application/fhir+json'])]) {
    const r = await fetch(url, { headers: { authorization: 'Bearer ' + tok, accept } });
    if (!r.ok) { tried.push(`${accept}:${r.status}`); continue; }
    const ct = (r.headers.get('content-type') || '').split(';')[0];
    if (/json/.test(ct)) { const j = await r.json(); if (j.data) return { mime: j.contentType || accept, data: j.data }; continue; }
    return { mime: ct || accept, data: Buffer.from(await r.arrayBuffer()).toString('base64') };
  }
  return { failed: tried.join(' ') };
}
const day = (r) => String(r.effectiveDateTime || r.effectivePeriod?.start || r.issued || r.date || r.period?.start || r.start || r.authoredOn || r.recordedDate || r.meta?.lastUpdated || '').slice(0, 10);
const text = (cc) => cc?.text || cc?.coding?.[0]?.display || '';
const htmlToText = (h) => String(h).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
function obsLine(o) {
  const v = o.valueQuantity ? `${o.valueQuantity.value} ${o.valueQuantity.unit || ''}`.trim() : o.valueString || text(o.valueCodeableConcept) || (o.valueBoolean ?? '');
  const rr = (o.referenceRange || []).map((x) => x.text || [x.low?.value, x.high?.value].filter((y) => y != null).join('-')).filter(Boolean).join('; ');
  const flag = (o.interpretation || []).map(text).filter(Boolean).join(', ');
  return `${text(o.code)} | ${v} | ${rr} | ${flag}`.replace(/\s*\|\s*\|\s*$/, '');
}

/* ---------- the check ---------- */
export async function medstarCheck(who) {
  const t0 = Date.now();
  const g = await grant();
  if (!g) return { ok: false, error: 'MedStar isn\'t connected yet. Tap "Connect MedStar" once and sign in to her myMedStar.' };
  let { token, patient } = await accessToken(g);
  let tokenAt = Date.now();
  const fresh = async () => { if (Date.now() - tokenAt > 420000) { token = (await accessToken(g)).token; tokenAt = Date.now(); } return token; }; // passes last ~9.5 minutes
  if (!patient) return { ok: false, error: 'MedStar did not say which patient the pass is for. Reconnect MedStar.' };
  const p = encodeURIComponent(patient);
  const [reports, labs, docs, appts] = await Promise.all([
    getAll(token, `DiagnosticReport?patient=${p}&_count=100`),
    getAll(token, `Observation?patient=${p}&category=laboratory&_count=200`),
    getAll(token, `DocumentReference?patient=${p}&_count=100`),
    getAll(token, `Appointment?patient=${p}&date=ge${new Date().toISOString().slice(0, 10)}&_count=50`).catch(() => []),
  ]);
  let seenList = [];
  try { seenList = await db('portal_items', { source: 'medstar' }); } catch {}
  // retry a note with no document only if MedStar didn't answer "not found" (404 = not released to patient apps)
  const seen = new Set(seenList.filter((x) => x.status !== 'no-document' || /:404/.test(x.note || '')).map((x) => x.key));
  const first = !seenList.length;
  const items = [];

  // labs: one text report per collection day
  const byDay = {};
  for (const o of labs) { const d = day(o); if (d) (byDay[d] ||= []).push(o); }
  for (const [d, list] of Object.entries(byDay)) items.push({ key: 'labs:' + d, date: d, kind: 'labs', title: `MedStar lab results · ${d}`, list });
  // reports with an attached document (imaging, pathology, etc.); lab panels are covered above
  for (const r of reports) {
    const cat = (r.category || []).map(text).join(' ').toLowerCase();
    if (/lab/.test(cat) && !(r.presentedForm || []).length) continue;
    items.push({ key: 'dr:' + r.id, date: day(r), kind: 'report', title: `MedStar report · ${text(r.code) || 'Report'} · ${day(r)}`, res: r });
  }
  // the same report often comes twice (as a report and as a document): keep the report
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const rep = new Set(items.filter((i) => i.kind === 'report').map((i) => i.date + '|' + norm(text(i.res.code))));
  for (const d of docs) {
    if (d.status && d.status !== 'current') continue;
    if (rep.has(day(d) + '|' + norm(text(d.type) || d.description))) continue;
    if (/requisition|insurance card|patient identification/i.test(text(d.type) || d.description || '')) continue; // order forms and ID scans, not results
    items.push({ key: 'doc:' + d.id, date: day(d), kind: 'doc', title: `MedStar note · ${text(d.type) || d.description || 'Document'} · ${day(d)}`, res: d });
  }

  const added = [], skipped = [], labcorp = [];
  const LC = /lab ?corp/i;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  // Anything dated before the baseline is already in her record from the MedStar export: mark it seen (in batches) and skip it.
  const old = items.filter((it) => !seen.has(it.key) && it.date && it.date < BASELINE);
  for (let i = 0; i < old.length; i += 25) await Promise.all(old.slice(i, i + 25).map((it) => db('portal_item_set', { source: 'medstar', key: it.key, title: it.title, status: 'baseline' }).catch(() => {})));
  old.forEach((it) => seen.add(it.key));
  let more = 0;
  for (const it of items.sort((a, b) => a.date.localeCompare(b.date))) {
    if (seen.has(it.key)) continue;
    if (Date.now() - t0 > 600000) { more++; continue; } // finish and log; the next check picks up the rest
    let mime = 'text/plain', data = '';
    if (it.kind === 'labs') {
      if (it.list.some((o) => LC.test(JSON.stringify(o.performer || [])))) labcorp.push(`Labcorp results from ${it.date} showed up in MedStar`);
      data = Buffer.from(`MEDSTAR LAB RESULTS (from the MedStar patient-access API)\nPatient: Naheed Saif\nCollected: ${it.date}\nFormat: Test | Result | Reference range | Flag\n\n${it.list.map(obsLine).join('\n')}`).toString('base64');
    } else {
      const att = [...(it.res.presentedForm || []), ...(it.res.content || []).map((c) => c.attachment)].filter(Boolean);
      const pdf = att.find((a) => /pdf/.test(a.contentType || '')), any = pdf || att[0];
      let got = null;
      if (any?.data) got = { mime: any.contentType || 'text/plain', data: any.data };
      else if (any?.url) got = await binary(await fresh(), any.url, pdf ? ['application/pdf'] : [any.contentType || 'text/html', 'application/pdf', 'text/plain']).catch((e) => ({ failed: String(e?.message || e) }));
      if (!got || got.failed !== undefined) {
        const why = !any ? 'no attachment listed' : got?.failed ? 'fetch failed ' + got.failed : 'no data';
        skipped.push(it.title);
        await db('portal_item_set', { source: 'medstar', key: it.key, title: it.title, status: 'no-document', note: `${why} · types: ${att.map((a) => a.contentType || '?').join(', ')}`.slice(0, 300) }).catch(() => {});
        continue;
      }
      if (/pdf/.test(got.mime)) { mime = 'application/pdf'; data = got.data; }
      else {
        const raw = Buffer.from(got.data, 'base64').toString('utf8');
        data = Buffer.from(`${it.title}\n\n${/html|xml/.test(got.mime) ? htmlToText(raw) : raw}`).toString('base64');
      }
    }
    const up = await db('upload_add', { name: `${it.title}.${mime === 'application/pdf' ? 'pdf' : 'txt'}`.slice(0, 200), mime, size: Buffer.from(data, 'base64').length, data, note: 'Brought in automatically from MedStar (official patient-access connection)', by: who, status: 'new' });
    await db('portal_item_set', { source: 'medstar', key: it.key, title: it.title, status: 'added', upload_id: up.id });
    added.push({ label: it.title, upload_id: up.id });
    if (apiKey && Date.now() - t0 < 480000) { // leave the rest for "Read it now" so the check finishes in time
      try {
        await db('upload_set', { id: up.id, status: 'reading', error: '' });
        const rd = await readUpload({ key: apiKey, mime, data, today: new Date().toDateString() });
        await db('upload_set', rd.error ? { id: up.id, status: 'failed', error: rd.error } : { id: up.id, status: autoStatus(rd.ai), ai: rd.ai, error: '' });
        if (!rd.error && LC.test(JSON.stringify(rd.ai || {}))) labcorp.push(`${it.title} mentions Labcorp`);
      } catch (e) { await db('upload_set', { id: up.id, status: 'failed', error: e?.message || 'read failed' }).catch(() => {}); }
    }
  }
  const upcoming = appts.filter((a) => /booked|pending|proposed/.test(a.status || '')).map((a) => `${String(a.start || '').slice(0, 16).replace('T', ' ')} · ${a.description || text(a.serviceType?.[0]) || text(a.appointmentType) || 'Appointment'}`);
  return { ok: true, checked: items.length, added: added.map((a) => a.label), skipped, upcoming, baseline: first ? old.length : 0, more, labcorp, addedList: added };
}

export async function runMedstar(who) {
  let out;
  try { out = await medstarCheck(who); } catch (e) { out = { ok: false, error: e?.message || 'The MedStar check failed', reconnect: !!e?.reconnect, hint: String(e?.detail || '') }; }
  const summary = out.ok ? { checked: out.checked, added: out.added, skipped: out.skipped, upcoming: out.upcoming, baseline: out.baseline, more: out.more, labcorp_hint: out.labcorp } : { error: out.error, reconnect: out.reconnect, hint: out.hint };
  if (!out.ok) console.error('[sync medstar]', out.error, out.hint || '');
  await db('portal_run_add', { source: 'medstar', by: who, ok: !!out.ok, summary }).catch(() => {});
  return { ok: !!out.ok, ...summary, added: out.addedList || [] };
}
