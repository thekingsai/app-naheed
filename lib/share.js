// Builds the slice of her record that one share link may show, and the files it may open.
import { readEncrypted } from '@/lib/vault';
import { db } from '@/lib/db';

let SRC = null;
export function src() {
  if (!SRC) SRC = JSON.parse(readEncrypted('share-src.json.enc').toString());
  return SRC;
}
const pad = (n) => String(n).padStart(2, '0');
export function toISO(s) { const d = new Date(s); return isNaN(d) ? null : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
const niceISO = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function itemLabel(it) {
  const { d, r } = src();
  if (it.t === 'scan') { const s = d.scans.find((x) => x.id === it.id); return s ? `${s.name} · ${s.date}` : null; }
  if (it.t === 'test') { const t = d.tests.find((x) => x.id === it.id); return t ? t.name : null; }
  if (it.t === 'day') {
    const v = (r.visits[it.id] || [])[0];
    const ok = v || r.labs[it.id] || (r.labcorp || {})[it.id];
    return ok ? `${v ? (v.type ? v.type + ' visit' : 'Visit') : 'Lab results'} · ${niceISO(it.id)}` : null;
  }
  return null;
}

export function cleanItems(items) {
  const seen = new Set(), out = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || !['scan', 'test', 'day'].includes(it.t) || typeof it.id !== 'string' || it.id.length > 20) continue;
    const k = it.t + ':' + it.id;
    if (seen.has(k) || !itemLabel(it)) continue;
    seen.add(k); out.push({ t: it.t, id: it.id });
  }
  return out.slice(0, 40);
}

function collect(o, set) {
  if (!o || typeof o !== 'object') return;
  for (const v of Object.values(o)) {
    if (typeof v === 'string' && v.startsWith('../source-data/') && v.endsWith('.pdf')) set.add(v.slice(15));
    else collect(v, set);
  }
}

// share = row from the database; returns everything the shared page needs and nothing else
export async function buildShare(share) {
  const { d, r } = src();
  const ai = !!share.include_ai;
  const items = cleanItems(share.items);
  const D = { pulled: d.pulled, groups: d.groups, tests: [], scans: [] };
  const R = { radnet: {}, pdf: { radnet: {} }, visits: {}, labs: {}, labcorp: {} };
  const folders = new Set();
  for (const it of items) {
    if (it.t === 'test') {
      const t = { ...d.tests.find((x) => x.id === it.id) };
      if (!ai) { delete t.say; delete t.ask; }
      D.tests.push(t);
    } else if (it.t === 'scan') {
      const s = { ...d.scans.find((x) => x.id === it.id) };
      delete s.visit;
      if (!ai) delete s.cmp;
      if (s.images) {
        s.images = { ...s.images }; delete s.images.share;
        const base = s.images.base.replace('../source-data/', '');
        if (/images\/$/.test(base)) s.images.series.forEach((se) => (se.files || []).forEach((f) => folders.add(base + f.split('/')[0] + '/')));
        else folders.add(base);
      }
      D.scans.push(s);
      const iso = toISO(s.date);
      const reps = (r.radnet[iso] || []).filter((x) => (s.acc || []).includes(x.acc));
      if (reps.length) R.radnet[iso] = [...(R.radnet[iso] || []), ...reps];
      for (const a of s.acc || []) if (r.pdf.radnet[a]) R.pdf.radnet[a] = r.pdf.radnet[a];
    } else if (it.t === 'day') {
      if (r.visits[it.id]) R.visits[it.id] = r.visits[it.id];
      if (r.labs[it.id]) R.labs[it.id] = r.labs[it.id];
      if ((r.labcorp || {})[it.id]) R.labcorp[it.id] = r.labcorp[it.id];
    }
  }
  let reads = [];
  if (ai && D.scans.length) {
    try { const all = await db('scanread_list', {}); reads = all.filter((x) => D.scans.some((s) => s.id === x.scan_id)).map((x) => ({ scan_id: x.scan_id, reading: x.reading, created_at: x.created_at })); } catch {}
  }
  const pdfs = new Set(); collect(D, pdfs); collect(R, pdfs);
  return {
    page: { meta: { token: share.token, by: share.created_by, created: share.created_at, note: share.note || '', ai, items }, D, R, reads },
    pdfs, folders,
  };
}

// Short in-memory cache so flipping through scan images doesn't hit the database for every image
const cache = new Map();
export async function getShare(token, count = false) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token || '')) return null;
  const c = cache.get(token);
  if (!count && c && Date.now() - c.t < 60_000) return c.v;
  const v = await db('share_get', { token, count });
  const out = v && v.token ? v : null;
  cache.set(token, { t: Date.now(), v: out });
  if (cache.size > 200) cache.clear();
  return out;
}
