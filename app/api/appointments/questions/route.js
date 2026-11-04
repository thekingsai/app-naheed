// The AI Doctors draft questions for an appointment the family added, from her whole record.
import { getRole, getWho } from '@/lib/session';
import { readEncrypted } from '@/lib/vault';
import { db } from '@/lib/db';
import { json, deny } from '@/lib/http';
export const runtime = 'nodejs';
export const maxDuration = 300;

const PROMPT = `You are the AI Doctor helping Naheed's family (she is 72) get ready for an upcoming appointment. Her complete record is above; the appointment is below.
Write under these bold labels:
**Why this visit matters**: one or two lines linking the visit to what is going on in her record now (recent results, symptoms, medicines, open orders), with dates.
**Questions to ask**: 4 to 6 specific questions, most important first, each with a short "why" from her record.
**Bring or check**: 2 to 4 short bullets (medicine list as she actually takes it, recent results, symptoms to describe).
About 250 words.
Naming: you are one of the app's AI Doctors, not one of her real doctors; call yourselves "the AI Doctors". "Her doctor" means only her real clinicians.
Honesty: never invent a value, date, medicine or decision; if something isn't in her records, say so. Don't tell her to start, stop or change a medicine; frame choices as questions for her doctor.
Format: plain English with the clinical term in brackets where useful, **bold labels** as section heads, short bullets, no # headings, no citation markers.`;

const fmt = (a) => `TODAY: ${new Date().toDateString()}\nAPPOINTMENT: ${a.kind} on ${a.date}${a.time ? ' at ' + a.time : ''}${a.place ? ' · ' + a.place : ''}${a.mode && a.mode !== 'In person' ? ' · ' + a.mode : ''}\nWhat it's for: ${a.reason || 'not given'}${a.notes ? '\nFamily notes: ' + a.notes : ''}`;

export async function GET(req) {
  if ((await getRole()) !== 'family') return deny();
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^[0-9a-f-]{36}$/.test(id)) return json(null);
  try { return json((await db('insight_list', { key: 'appt:' + id, detail: 'true' }))[0] || null); } catch { return json(null); }
}

export async function POST(req) {
  if ((await getRole()) !== 'family') return deny();
  const who = await getWho();
  if (!['Imran', 'Salman'].includes(who)) return json({ error: 'Only Imran or Salman can ask the AI Doctors for this.' }, 403);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: 'The server has no API key.' }, 428);
  const { id = '' } = await req.json().catch(() => ({}));
  const a = (await db('appt_list', {})).find((x) => x.id === id && !x.deleted);
  if (!a) return json({ error: 'Appointment not found' }, 404);
  const record = readEncrypted('ask-context.txt.enc').toString();
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 2000,
        system: [{ type: 'text', text: "NAHEED'S COMPLETE RECORD:\n" + record, cache_control: { type: 'ephemeral', ttl: '1h' } }, { type: 'text', text: PROMPT }],
        messages: [{ role: 'user', content: fmt(a) }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message || `Model error ${r.status}`);
    const body = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
    const hash = [a.date, a.time, a.kind, a.reason, a.notes].join('|');
    await db('insight_set', { key: 'appt:' + id, kind: 'appt', title: `Questions for ${a.kind} · ${a.date}`, body, detail: null, hash, model: 'claude-opus-5-5', by: who });
    return json({ ok: true, body });
  } catch (e) {
    console.error('[appt-questions]', id, e?.message);
    return json({ error: `The AI Doctors didn't finish: ${e?.message || 'unknown error'}` }, 502);
  }
}
