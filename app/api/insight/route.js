// AI Doctors' insights for lab tests (two AI Doctors) and visit summaries (one AI Doctor), saved in her record.
import { getRole, getWho } from '@/lib/session';
import { readEncrypted } from '@/lib/vault';
import { db } from '@/lib/db';
import { json, deny } from '@/lib/http';
import { insightItem, recentKeys } from '@/lib/insights';

export const runtime = 'nodejs';
export const maxDuration = 600;

const NAMING = `Naming: you are one of the app's AI Doctors, not one of her real doctors. Call yourselves "the AI Doctors" (or "the AI specialist" / "the AI senior doctor"). "Her doctor", "Dr. X" and "the radiologist" mean only her real clinicians; keep what they wrote clearly separate from the AI Doctors' view, and name the real clinician and the date when you mention their notes.
Honesty: never invent a value, date, medicine or decision; if something isn't in her records, say "not found in her records". Never soften or overcall. Don't tell her to start, stop or change a medicine; frame choices as questions for her doctor.
Format: plain English with the clinical term in brackets where useful, **bold labels** as section heads, short bullets, no # headings, no citation markers.`;

const VISIT = `You are the AI Doctor writing a visit summary for Naheed (72) for her family. Her complete record is above. The visit or lab day to summarise is given below; find its doctor's notes, orders and results in her record.
Write under these bold labels (skip one only if it truly doesn't apply, e.g. a lab-only day):
**What happened**: why she went, who she saw (name and role), what they found.
**What was decided**: the doctor's assessment and plan.
**What changed**: medicines started, stopped or changed (with doses), new diagnoses, tests and referrals ordered.
**Follow-through**: for each order, referral or follow-up from this visit, check her LATER records: was it done, when, and what it showed? Say plainly "not found in her records" when it wasn't.
**Results in context**: that day's labs and vitals against her own trend; which flags matter and which don't.
**Questions for her next visit**: 2 to 4 specific questions.
About 300 words.
${NAMING}`;

const LAB_SPEC = (sp, title) => `You are the AI specialist, one of the app's AI Doctors, working as a senior consultant ${title} (${sp}). Explain one of Naheed's lab tests (she is 72) for her family, using her complete record above.
Write under these bold labels:
**What the trend shows**: the values over time against the normal range, in plain words.
**Why it moved**: link changes to her medicines (with start dates and doses), infusions, illnesses or events in her record, with dates. Say when a link is a guess.
**Related tests**: tests that move with this one in her record and what they add (name the values and dates).
**What it means for her**: whether the flag matters at her age and with her conditions (RA on Truxima, heart condition, osteoporosis, kidneys, lungs), and how certain you are.
**What her doctors said**: what her real doctors wrote about this result (name and date); if nothing, say "not found in her records".
**When to retest and what to ask**: one or two lines.
About 300 words. The AI senior doctor will review your answer, so show your reasoning.
${NAMING}`;
const LAB_BLIND = (sp) => `You are the AI senior doctor, one of the app's AI Doctors, working as a chief of internal medicine. Give your own independent view of this lab test for Naheed (72), with her whole record in mind. An AI ${sp} specialist is writing separately; think for yourself. Key points, links to her medicines and conditions, what matters, your certainty. About 180 words.
${NAMING}`;
const LAB_REVIEW = `You are the AI senior doctor. You wrote an independent view of this lab test (below) and the AI specialist wrote theirs. Check both against her whole record; where you differ, decide who is right from the record and evidence, and say so.
Output exactly:
- 3 to 5 short bullets, each starting with "Agree:", "Differ:", "Correction:", "Adds:" or "Caution:".
- Then a line containing only %%FINAL%%
- Then the AI Doctors' final insight under these bold labels: **What the trend shows**, **Why it moved**, **Related tests**, **What it means for her**, **What her doctors said**, **When to retest and what to ask**. About 300 words.
${NAMING}`;

async function ask(key, model, system, content, max_tokens) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens, system, messages: [{ role: 'user', content }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `Model error ${r.status}`);
  return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
}

export async function GET(req) {
  if ((await getRole()) !== 'family') return deny();
  const u = new URL(req.url), key = u.searchParams.get('key');
  if (u.searchParams.get('recent')) return json(recentKeys());
  try {
    const list = await db('insight_list', key ? { key, detail: 'true' } : {});
    const out = list.filter((x) => key || !String(x.key).startsWith('appt:')).map((x) => { const it = insightItem(x.key); return { ...x, stale: !!(it && x.data_hash && it.hash !== x.data_hash) }; });
    return json(key ? out[0] || null : out);
  } catch { return json(key ? null : []); }
}

export async function POST(req) {
  if ((await getRole()) !== 'family') return deny();
  const who = await getWho();
  if (!['Imran', 'Salman'].includes(who)) return json({ error: { message: 'Only Imran or Salman can ask the AI Doctors for this.' } }, 403);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: { message: 'The server has no API key.' } }, 428);
  const { key: k = '' } = await req.json().catch(() => ({}));
  const it = insightItem(k);
  if (!it) return json({ error: { message: 'Unknown item' } }, 404);
  const record = readEncrypted('ask-context.txt.enc').toString();
  const sys = (role) => [{ type: 'text', text: "NAHEED'S COMPLETE RECORD:\n" + record, cache_control: { type: 'ephemeral', ttl: '1h' } }, { type: 'text', text: role }];
  const today = new Date().toDateString();
  const item = `TODAY: ${today}\n${it.kind === 'day' ? 'VISIT OR LAB DAY TO SUMMARISE' : 'LAB TEST TO EXPLAIN'}: ${it.title}\n${JSON.stringify(it.data)}`;
  try {
    let body, detail, model;
    if (it.kind === 'day') {
      body = await ask(key, 'claude-opus-5-5', sys(VISIT), item, 2500);
      detail = null; model = 'claude-opus-5-5';
    } else {
      const [spec, blind] = await Promise.all([
        ask(key, 'claude-opus-5-5', sys(LAB_SPEC(it.specialty, it.specTitle)), item, 2500),
        ask(key, 'claude-fable-5-1', sys(LAB_BLIND(it.specialty)), item, 1500),
      ]);
      const out = await ask(key, 'claude-fable-5-1', sys(LAB_REVIEW), `${item}\n\nYOUR OWN INDEPENDENT VIEW (written before reading the AI specialist):\n${blind}\n\nTHE AI ${it.specTitle.toUpperCase()}'S INSIGHT:\n${spec}`, 3000);
      const i = out.indexOf('%%FINAL%%');
      body = i >= 0 ? out.slice(i + 9).trim() : out;
      detail = JSON.stringify({ specialist: spec, specialty: it.specialty, blind, review: i >= 0 ? out.slice(0, i).trim() : '' });
      model = 'claude-opus-5-5+claude-fable-5-1';
    }
    await db('insight_set', { key: it.key, kind: it.kind, title: it.title, body, detail, hash: it.hash, model, by: who });
    return json({ ok: true, key: it.key });
  } catch (e) {
    console.error('[insight]', it.key, e?.message);
    return json({ error: { message: `The AI Doctors didn't finish: ${e?.message || 'unknown error'}` } }, 502);
  }
}
