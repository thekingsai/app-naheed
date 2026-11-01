import { getRole, getWho } from '@/lib/session';
import { readEncrypted, readPlain } from '@/lib/vault';
import { db } from '@/lib/db';
import { json, deny } from '@/lib/http';
import { extractNotes, notesBlock } from '@/lib/learn';
import { uploadsBlock } from '@/lib/reader';
import { finalOf } from '@/lib/answers';

export const runtime = 'nodejs';
export const maxDuration = 600;

const MODELS = new Set(['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
const LENS = {
  short: { t: 'Reply length: SHORT. Two to four sentences or up to four bullets, about 80 words, then the Sources line.', m: 1500 },
  medium: { t: 'Reply length: MEDIUM. About 200 words: the answer, a few bullets, then the Sources line.', m: 3000 },
  detailed: { t: 'Reply length: DETAILED. A thorough answer, up to about 600 words, with short headed sections if helpful, then the Sources line.', m: 6000 },
};

const MODES = {
  layman: 'Mode: LAYMAN. Everyday words only, as if explaining to a family member with no medical background. Explain every medical term in plain language, use a simple comparison when it helps, and focus on what it means for her and what to ask or do. Give numbers only with what they mean (for example "67, above the normal top of 40").',
  technical: 'Mode: TECHNICAL. Write for a physician reviewing her case. Use precise clinical terminology and standard abbreviations (e.g. HFmrEF, LVEF, NT-proBNP, ESR, BI-RADS, TI-RADS, C5–C6 foraminal stenosis). Give exact values with units, reference ranges and dates, trends, pertinent negatives, current medications with doses, relevant history and comorbidities, and guideline-based considerations or differentials where useful. Concise clinical style, like a consult summary. In this mode use the exact clinical names, including heart failure and the breast findings.',
  hybrid: 'Mode: HYBRID. Start with a plain-English answer anyone in the family can follow, then a short part labelled **Clinical detail** on its own line with the technical terms, exact values with units, reference ranges and dates a doctor would want.',
};

const ROUTER = `Decide how a family health app should answer a question about Naheed (72, with rheumatoid arthritis, a heart condition, osteoporosis, asthma and lung changes, a pinched nerve in the neck).
Return JSON only: {"two": true|false, "specialty": "", "title": ""}
- two = true when the question needs medical judgment that belongs mainly to ONE specific field (for example her heart, her RA, her lungs, her bones, her neck pain, a medicine's safety, a lab or scan in one area).
- two = false for admin or lookup questions (dates, appointments, who her doctor is, what a file says), for greetings, and for broad questions that span her whole health (for example "what should I raise at her next visit").
- specialty: the field, e.g. Cardiology, Rheumatology, Pulmonology, Endocrinology, Pain medicine and spine, Orthopaedics, Nephrology, Hematology, Breast health, Infectious disease, Gastroenterology and liver, Neurology, Allergy and immunology, Clinical pharmacology, Radiology.
- title: the specialist's job title, e.g. cardiologist, rheumatologist.`;

const SPECIALIST = (sp, title) => `YOUR ROLE IN THIS ANSWER: you are the specialist, a senior consultant ${title} (${sp}). Answer from deep, current ${sp} knowledge and her actual record.
- Be completely honest. Never soften findings or tell the family what they want to hear. Base every statement on her record, established evidence or current guidelines, and say which.
- Say plainly when something is outside ${sp} or needs another specialist.
- A senior physician will review your answer next, so state your reasoning and your level of certainty.
- Use the reply length, mode, inline [[Source | exact words]] markers and the Sources line as instructed.
- Start directly with your answer. No heading with your name or role.`;

const SENIOR = (sp, title) => `YOUR ROLE IN THIS ANSWER: you are the senior physician, a chief of internal medicine with deep knowledge across every field. A ${title} (${sp}) has just answered the family's question; their answer is below.
1. Review it critically against her WHOLE record and current evidence: what is right, what is wrong or overstated, what is missing, and how her other conditions and medicines change the picture (heart, kidneys, RA and Truxima, osteoporosis, allergies to aspirin and ibuprofen, lungs).
   Be completely honest. Agree briefly where the specialist is right; never invent disagreements; never soften or please anyone.
2. Then give the final combined answer the family should rely on.
Output format, exactly:
- Your review first: 3 to 6 short bullets, each starting with "Agree:", "Correction:", "Adds:" or "Caution:". Use [[Source | exact words]] markers.
- Then a line containing only %%FINAL%%
- Then the final combined answer, following the reply length and mode, with inline [[Source | exact words]] markers and ending with the Sources line.
No headings with your name or role.`;

async function callModel({ key, model, system, messages, max_tokens, web = true, onText, onWeb, onSearch }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens, stream: true, ...(web ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }] } : {}), system, messages }),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e?.error?.message || `Model error ${r.status}`); }
  const rd = r.body.getReader(), dec = new TextDecoder();
  let buf = '', text = '', paused = false;
  while (true) {
    const { done, value } = await rd.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const ev = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = ev.split('\n').find((x) => x.startsWith('data: '));
      if (!line) continue;
      let j; try { j = JSON.parse(line.slice(6)); } catch { continue; }
      if (j.type === 'content_block_start' && j.content_block?.type === 'server_tool_use') onSearch && onSearch();
      if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') { text += j.delta.text; onText && onText(j.delta.text); }
      if (j.type === 'content_block_delta' && j.delta?.type === 'citations_delta' && j.delta.citation?.url) onWeb && onWeb(j.delta.citation.url, j.delta.citation.title);
      if (j.type === 'message_delta' && j.delta?.stop_reason === 'pause_turn') paused = true;
      if (j.type === 'error') throw new Error(j.error?.message || 'Model error');
    }
  }
  if (paused) { const t = '\n\n(The web search took too long and stopped early. Ask again for a complete answer.)'; text += t; onText && onText(t); }
  return text;
}

async function route(key, question) {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 200, system: ROUTER, messages: [{ role: 'user', content: question.slice(0, 2000) }] }),
    });
    if (!r.ok) return { two: false };
    const j = await r.json();
    const t = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    const m = t.match(/\{[\s\S]*\}/);
    const a = m ? JSON.parse(m[0]) : {};
    return { two: !!a.two && !!a.specialty, specialty: String(a.specialty || '').slice(0, 60), title: String(a.title || 'specialist').slice(0, 60) };
  } catch { return { two: false }; }
}

export async function POST(req) {
  if ((await getRole()) !== 'family') return deny();
  const who = await getWho();
  const key = process.env.ANTHROPIC_API_KEY || req.headers.get('x-anthropic-key') || '';
  if (!key) return json({ error: { message: 'Ask AI needs an API key. Add it in Settings, or add ANTHROPIC_API_KEY to the server.' } }, 428);

  const { question = '', history = [], len = 'medium', mode = 'hybrid', model = 'claude-opus-5-5' } = await req.json();
  const M = MODES[mode === 'doctor' ? 'technical' : mode] || MODES.hybrid;
  if (typeof question !== 'string' || !question.trim() || question.length > 4000) return json({ error: { message: 'Bad question' } }, 400);
  const L = LENS[len] || LENS.medium;
  const today = new Date().toDateString();

  let notes = [], chats = [], uploads = [];
  try { [notes, chats, uploads] = await Promise.all([db('notes_list', {}), db('chat_list', { limit: 30 }), db('upload_list', {})]); } catch {}

  const rules = readPlain('system-prompt.md').toString().replace('{{TODAY}}', today).replace('{{ASKER}}', who ? `${who}, one of Naheed's sons` : 'a family member (Imran or his brother Salman)');
  const record = readEncrypted('ask-context.txt.enc').toString();
  const base = [
    { type: 'text', text: rules },
    { type: 'text', text: "NAHEED'S COMPLETE RECORD:\n" + record, cache_control: { type: 'ephemeral', ttl: '1h' } },
    { type: 'text', text: notesBlock(notes, chats.map((c) => ({ ...c, content: finalOf(c.content) }))) + '\n\n' + uploadsBlock(uploads) },
  ];
  const past = history.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-12)
    .map((m) => ({ role: m.role, content: finalOf(m.content).slice(0, 8000) }));
  const ask = { role: 'user', content: `${question}\n\n(${L.t} ${M})` };
  const msgs = [...past, ask];
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();

  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (o) => controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      let stored = '', finalText = '';
      try {
        const plan = await route(key, question);
        if (!plan.two) {
          send({ type: 'naheed_stage', stage: 'single' });
          const txt = await callModel({ key, model: MODELS.has(model) ? model : 'claude-opus-5-5', system: base, messages: msgs, max_tokens: L.m,
            onText: (t) => send({ type: 'naheed_delta', stage: 'single', text: t }), onWeb: (u, t) => send({ type: 'naheed_web', url: u, title: t }),
            onSearch: () => send({ type: 'naheed_status', text: 'Checking current medical guidance on the web…' }) });
          stored = txt; finalText = txt;
        } else {
          send({ type: 'naheed_stage', stage: 'specialist', specialty: plan.specialty, title: plan.title });
          const spec = await callModel({ key, model: 'claude-opus-5-5', system: [...base, { type: 'text', text: SPECIALIST(plan.specialty, plan.title) }], messages: msgs, max_tokens: L.m,
            onText: (t) => send({ type: 'naheed_delta', stage: 'specialist', text: t }), onWeb: (u, t) => send({ type: 'naheed_web', url: u, title: t }),
            onSearch: () => send({ type: 'naheed_status', text: `The ${plan.title} is checking current guidance…` }) });
          send({ type: 'naheed_stage', stage: 'senior' });
          const seniorMsgs = [...past, { role: 'user', content: `${question}\n\n(${L.t} ${M})\n\nTHE ${plan.title.toUpperCase()}'S ANSWER TO REVIEW:\n${spec}` }];
          while (seniorMsgs.length && seniorMsgs[0].role !== 'user') seniorMsgs.shift();
          const senior = await callModel({ key, model: 'claude-fable-5-1', system: [...base, { type: 'text', text: SENIOR(plan.specialty, plan.title) }], messages: seniorMsgs, max_tokens: L.m + 1500,
            onText: (t) => send({ type: 'naheed_delta', stage: 'senior', text: t }), onWeb: (u, t) => send({ type: 'naheed_web', url: u, title: t }),
            onSearch: () => send({ type: 'naheed_status', text: 'The senior doctor is checking current guidance…' }) });
          stored = `%%SPECIALIST:${plan.specialty}%%\n${spec}\n%%SENIOR%%\n${senior}`;
          finalText = finalOf(stored);
        }
        // Save the turn to the shared history, notify tagged people, then learn from it.
        let userId = null, assistantId = null;
        try {
          userId = (await db('chat_add', { role: 'user', content: question, asker: who || 'Family' })).id;
          assistantId = (await db('chat_add', { role: 'assistant', content: stored || '(no answer)', model: plan.two ? 'claude-opus-5-5+claude-fable-5-1' : model, asker: 'Assistant' })).id;
          const tagged = [...new Set((question.match(/@(imran|salman)\b/gi) || []).map((t) => t[1].toUpperCase() + t.slice(2).toLowerCase()))].filter((t) => t !== who);
          for (const to of tagged) { try { await db('mention_add', { message_id: userId, from: who || 'Family', to }); } catch {} }
        } catch {}
        let result = [];
        try {
          const actions = await extractNotes({ key, notes, question, answer: finalText, today });
          if (actions.length) result = await db('notes_apply', { actions: actions.map((a) => ({ ...a, source_message: userId || '', by: who || 'Family' })) });
        } catch {}
        send({ type: 'naheed_notes', saved: result.filter((x) => x.op === 'add' && !x.pending), pending: result.filter((x) => x.op === 'add' && x.pending),
          corrected: result.filter((x) => x.op === 'correct'), userId, assistantId });
      } catch (e) {
        send({ type: 'error', error: { message: e?.message ? `Ask AI ran into a problem: ${e.message}` : 'The answer was cut off. Please try again.' } });
      } finally { controller.close(); }
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' } });
}
