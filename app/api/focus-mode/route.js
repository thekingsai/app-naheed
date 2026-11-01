// The Focus page in Layman or Technical wording, rewritten once by an AI Doctor and saved.
// Hybrid is the page as written. A saved version is reused until the Focus page itself changes.
import crypto from 'node:crypto';
import { getRole, getWho } from '@/lib/session';
import { readEncrypted } from '@/lib/vault';
import { db } from '@/lib/db';
import { json, deny } from '@/lib/http';
import { src } from '@/lib/share';

export const runtime = 'nodejs';
export const maxDuration = 600;

const MODES = {
  layman: `LAYMAN: everyday words only, for a family member with no medical background, and CONCISE: shorten every text to its essential point (about half the length or less). Explain any medical word in plain language. Keep numbers only with what they mean.`,
  technical: `TECHNICAL: for a physician reviewing her case. Precise clinical terminology and standard abbreviations (e.g. C5-C6 foraminal stenosis, cervical radiculopathy, Spurling's, ESR, LVEF). Add the relevant details from her record: exact values with units and reference ranges, dates, medication names and doses, exam findings, pertinent negatives, differentials and guideline considerations where useful. More detailed than the original, but no padding.`,
};
// Only these text fields are rewritten; ids, dates, links and levels are never touched.
const TEXT = { title: 1, facts: 1, whatsnew: ['text'], standing: ['k', 'v'], timeline: ['text'], links: ['title', 'text'], options: ['title', 'text', 'her'], home: 1, questions: 1 };

function merge(orig, out) {
  const F = JSON.parse(JSON.stringify(orig));
  for (const [k, spec] of Object.entries(TEXT)) {
    const a = F[k], b = out?.[k];
    if (spec === 1) {
      if (typeof a === 'string' && typeof b === 'string' && b.trim()) F[k] = b.trim();
      else if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) F[k] = a.map((x, i) => (typeof b[i] === 'string' && b[i].trim() ? b[i].trim() : x));
    } else if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      a.forEach((x, i) => spec.forEach((f) => { if (typeof b[i]?.[f] === 'string' && b[i][f].trim()) x[f] = b[i][f].trim(); }));
    }
  }
  if (out?.warnings && Array.isArray(out.warnings.call911) && Array.isArray(out.warnings.today)
      && out.warnings.call911.length === F.warnings.call911.length && out.warnings.today.length === F.warnings.today.length) {
    F.warnings = { call911: out.warnings.call911.map((x, i) => (typeof x === 'string' && x.trim() ? x.trim() : F.warnings.call911[i])), today: out.warnings.today.map((x, i) => (typeof x === 'string' && x.trim() ? x.trim() : F.warnings.today[i])) };
  }
  return F;
}

function current() {
  const F = src().d.focus?.active;
  if (!F) return null;
  return { F, hash: crypto.createHash('sha1').update(JSON.stringify(F)).digest('hex').slice(0, 16) };
}

export async function GET(req) {
  if ((await getRole()) !== 'family') return deny();
  const mode = new URL(req.url).searchParams.get('mode');
  const c = current();
  if (!c || !MODES[mode]) return json(null);
  try {
    const [row] = await db('insight_list', { key: `focus:${c.F.id}:${mode}` });
    if (!row || row.data_hash !== c.hash) return json(null);
    return json({ mode, focus: JSON.parse(row.body), created_at: row.created_at });
  } catch { return json(null); }
}

export async function POST(req) {
  if ((await getRole()) !== 'family') return deny();
  const who = await getWho();
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: { message: 'The server has no API key.' } }, 428);
  const { mode = '' } = await req.json().catch(() => ({}));
  const c = current();
  if (!c || !MODES[mode]) return json({ error: { message: 'Unknown mode' } }, 400);
  const record = readEncrypted('ask-context.txt.enc').toString();
  const system = [
    { type: 'text', text: "NAHEED'S COMPLETE RECORD:\n" + record, cache_control: { type: 'ephemeral', ttl: '1h' } },
    { type: 'text', text: `You are one of the app's AI Doctors. Rewrite the family's Focus page about Naheed (72) in this style:\n${MODES[mode]}\nRules: keep every fact true to her record; never invent; keep what her real doctors said clearly attributed to them (name and date); the app's own views are the AI Doctors' views. Keep the safety warnings' meaning exactly. Return ONLY JSON with the same keys, the same array lengths and the same order as the input; rewrite only these text values: title, facts, whatsnew[].text, standing[].k and .v, timeline[].text, links[].title and .text, options[].title, .text and .her, home, warnings.call911, warnings.today, questions. No markdown.` },
  ];
  const input = Object.fromEntries(Object.keys(TEXT).concat('warnings').map((k) => [k, c.F[k]]));
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-opus-5-5', max_tokens: mode === 'technical' ? 12000 : 6000, system, messages: [{ role: 'user', content: JSON.stringify(input) }] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message || `Model error ${r.status}`);
    const t = (j.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('');
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('No JSON returned');
    const F = merge(c.F, JSON.parse(m[0]));
    await db('insight_set', { key: `focus:${c.F.id}:${mode}`, kind: 'focus', title: `Focus · ${mode}`, body: JSON.stringify(F), detail: null, hash: c.hash, model: 'claude-opus-5-5', by: who || 'Family' });
    return json({ mode, focus: F });
  } catch (e) {
    console.error('[focus-mode]', mode, e?.message);
    return json({ error: { message: `The AI Doctors couldn't rewrite this: ${e?.message || 'unknown error'}` } }, 502);
  }
}
