import { getRole, getWho } from '@/lib/session';
import { readEncrypted, readPlain, docFile, exists } from '@/lib/vault';
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
- two = true for any question that needs medical judgment: what a result, scan, symptom or medicine means, whether something is safe, what to do or ask, how things are trending. If it touches two related fields, still set two = true and pick the field most central to the question.
- two = true whenever the family asks for both doctors, the specialist, a second opinion or a review, including follow-ups like "I meant both AI doctors"; then take the topic from the earlier conversation.
- two = false only for admin or lookup questions (dates, appointments, who her doctor is, what a file says), greetings, questions about the app itself, and whole-health checklists like "what should I raise at her next visit".
- specialty: the field, e.g. Cardiology, Rheumatology, Pulmonology, Endocrinology, Pain medicine and spine, Orthopaedics, Nephrology, Hematology, Breast health, Infectious disease, Gastroenterology and liver, Neurology, Allergy and immunology, Clinical pharmacology, Radiology.
- title: the specialist's job title, e.g. cardiologist, rheumatologist.`;

const SINGLE = `ABOUT THIS APP: medical questions in AiHealth are normally answered by two AI doctors working in sequence: a specialist in the relevant field, then a senior physician who reviews that answer against her whole record and writes the combined answer. This question was judged to be admin, lookup or a whole-health checklist, so you are answering it alone. If the family asks for the two doctors, say they can ask the medical question directly (for example "What does her ESR trend mean?") and it will go to both. Never say you can't reach the other doctors.`;

const SPECIALIST = (sp, title) => `YOUR ROLE IN THIS ANSWER: you are the specialist, a senior consultant ${title} (${sp}). Answer from deep, current ${sp} knowledge and her actual record.
- Be completely honest. Never soften findings or tell the family what they want to hear. Base every statement on her record, established evidence or current guidelines, and say which.
- Say plainly when something is outside ${sp} or needs another specialist.
- A senior physician will review your answer next, so state your reasoning and your level of certainty.
- Use the reply length, mode, inline [[Source | exact words]] markers and the Sources line as instructed.
- Start directly with your answer. No heading with your name or role.`;

const SENIOR_BLIND = (sp) => `YOUR ROLE IN THIS ANSWER: you are the senior physician, a chief of internal medicine with deep knowledge across every field. Give your OWN independent view of the family's question, looking at her whole record (heart, kidneys, RA and Truxima, osteoporosis, allergies to aspirin and ibuprofen, lungs) and current evidence.
- A ${sp} specialist is answering the same question separately; you will compare answers afterwards, so think for yourself and don't guess what they will say.
- Be completely honest; never soften anything or please anyone. Say how certain you are.
- Keep it concise: the key points and your reasoning, with [[Source | exact words]] markers. No Sources line, no headings with your name or role.`;

const SENIOR = (sp, title) => `YOUR ROLE IN THIS ANSWER: you are the senior physician, a chief of internal medicine with deep knowledge across every field. A ${title} (${sp}) has answered the family's question. Before seeing their answer, you wrote your own independent view; both are below.
1. Compare the ${title}'s answer with your own view and review it critically against her WHOLE record and current evidence. Where you and the specialist differ, decide who is right based on her record and the evidence, and say so: what is right, what is wrong or overstated, what is missing, and how her other conditions and medicines change the picture (heart, kidneys, RA and Truxima, osteoporosis, allergies to aspirin and ibuprofen, lungs).
   Be completely honest. Agree briefly where the specialist is right; never invent disagreements; never soften or please anyone.
2. Then give the final combined answer the family should rely on.
Output format, exactly:
- Your review first: 3 to 6 short bullets, each starting with "Agree:", "Differ:", "Correction:", "Adds:" or "Caution:". Use [[Source | exact words]] markers.
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

// Backup when the sorting call fails: obvious medical words pick the field.
const FIELDS = [
  [/\b(neck|spine|spinal|cervical|radicul|pinched|nerve|mri|sciatica|back pain|numb)/i, 'Pain medicine and spine', 'spine and pain specialist'],
  [/\b(esr|crp|rheumat|arthritis|\bra\b|truxima|rituximab|vectra|methotrexate|joint)/i, 'Rheumatology', 'rheumatologist'],
  [/\b(heart|cardi|echo|ejection|bnp|blood pressure|sglt2|chest pain|valve)/i, 'Cardiology', 'cardiologist'],
  [/\b(lung|pulmon|cough|asthma|bronch|pneumonia|breath|ct chest|pseudomonas)/i, 'Pulmonology', 'pulmonologist'],
  [/\b(bone|osteopor|dexa|prolia|fracture|t-score)/i, 'Endocrinology and bone health', 'endocrinologist'],
  [/\b(thyroid|tsh|nodule|a1c|diabet|sugar|cholesterol|ldl|statin)/i, 'Endocrinology', 'endocrinologist'],
  [/\b(kidney|egfr|creatinine|renal)/i, 'Nephrology', 'nephrologist'],
  [/\b(breast|mammo|nipple)/i, 'Breast health', 'breast specialist'],
  [/\b(celebrex|ibuprofen|aspirin|medicine|medication|drug|dose|side effect|tylenol|nsaid)/i, 'Clinical pharmacology', 'clinical pharmacologist'],
  [/\b(hemoglobin|anemi|mch|iron|ferritin|b12|platelet)/i, 'Hematology', 'hematologist'],
];
const WANTS_TWO = /\bboth\b[^.?!]{0,24}\bdoctors?\b|\b(two|2)\b[^.?!]{0,12}\bdoctors?\b|\bspecialists?\b|second opinion|\breview\b/i;
function guess(text) { for (const [re, sp, title] of FIELDS) if (re.test(text)) return { specialty: sp, title }; return null; }

async function route(key, question, past) {
  let plan = { two: false };
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 200, system: ROUTER, messages: [{ role: 'user', content: `${past ? `EARLIER CONVERSATION (for context):\n${past}\n\n` : ''}QUESTION TO ROUTE:\n${question.slice(0, 2000)}` }] }),
    });
    if (!r.ok) { console.error('[ask] router http', r.status, (await r.text()).slice(0, 200)); plan.failed = true; }
    else {
      const j = await r.json();
      const t = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
      const m = t.match(/\{[\s\S]*\}/);
      const a = m ? JSON.parse(m[0]) : {};
      plan = { two: !!a.two && !!a.specialty, specialty: String(a.specialty || '').slice(0, 60), title: String(a.title || 'specialist').slice(0, 60) };
    }
  } catch (e) { console.error('[ask] router error', e?.message); plan.failed = true; }
  // Asking for both doctors always gets both; a failed sorting call falls back to obvious medical words.
  if (!plan.two && (WANTS_TWO.test(question) || plan.failed)) {
    const g = guess(question) || guess(past || '');
    if (g && (WANTS_TWO.test(question) || plan.failed)) plan = { two: true, ...g };
    else if (WANTS_TWO.test(question)) plan = { two: true, specialty: 'General internal medicine', title: 'internist' };
  }
  console.log('[ask] plan', JSON.stringify({ two: plan.two, specialty: plan.specialty || '', failed: !!plan.failed }));
  return plan;
}

export async function POST(req) {
  if ((await getRole()) !== 'family') return deny();
  const who = await getWho();
  const key = process.env.ANTHROPIC_API_KEY || req.headers.get('x-anthropic-key') || '';
  if (!key) return json({ error: { message: 'Ask AI needs an API key. Add it in Settings, or add ANTHROPIC_API_KEY to the server.' } }, 428);

  const { question = '', history = [], len = 'medium', mode = 'hybrid', model = 'claude-opus-5-5', images = [], imagesLabel = '' } = await req.json();
  // Scan images attached from a scan page: only her stored RadNet images, at most 12.
  const imgs = (Array.isArray(images) ? images : []).filter((p) => typeof p === 'string' && /^radnet\/images\/[\w\-.]+\/[\w\-.]+\.jpg$/.test(p) && exists(docFile(p))).slice(0, 12);
  const imgBlocks = imgs.flatMap((p) => [{ type: 'text', text: `Image: ${p.split('/').pop().replace('.jpg', '')}` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: readEncrypted(docFile(p)).toString('base64') } }]);
  const label = String(imagesLabel || '').slice(0, 120);
  const IMG_NOTE = imgs.length ? `\n\nATTACHED IMAGES: ${imgs.length} reference images from her ${label || 'scan'}, exported from the patient portal as JPEGs (file names give the series and slice number: SAG = side view, AX = cross-section; T2/STIR show fluid and swelling bright, T1 shows anatomy). You are not her radiologist: describe what you can see carefully, say plainly what cannot be judged from these images (a few slices, no measurements, no full study), never present an image finding as a diagnosis, and say that the radiologist's report is the official reading and takes precedence when it disagrees.` : '';
  const M = MODES[mode === 'doctor' ? 'technical' : mode] || MODES.hybrid;
  if (typeof question !== 'string' || !question.trim() || question.length > 4000) return json({ error: { message: 'Bad question' } }, 400);
  const L = LENS[len] || LENS.medium;
  const today = new Date().toDateString();

  let notes = [], chats = [], uploads = [];
  try { [notes, chats, uploads] = await Promise.all([db('notes_list', {}), db('chat_list', { limit: 30 }), db('upload_list', {})]); } catch {}

  // Keep everything before her record identical for every question, so the cached record is reused
  // across days and between Imran and Salman. Today's date and the asker go after the record.
  const rules = readPlain('system-prompt.md').toString().replace('{{TODAY}}', 'given under CURRENT CONTEXT below').replace('{{ASKER}}', 'given under CURRENT CONTEXT below');
  const asker = who ? `${who}, one of Naheed's sons` : 'a family member (Imran or his brother Salman)';
  const record = readEncrypted('ask-context.txt.enc').toString();
  const base = [
    { type: 'text', text: rules },
    { type: 'text', text: "NAHEED'S COMPLETE RECORD:\n" + record, cache_control: { type: 'ephemeral', ttl: '1h' } },
    { type: 'text', text: `CURRENT CONTEXT\nToday is ${today}. The person asking is ${asker}.\n\n` + notesBlock(notes, chats.map((c) => ({ ...c, content: finalOf(c.content) }))) + '\n\n' + uploadsBlock(uploads) },
  ];
  const past = history.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-12)
    .map((m) => ({ role: m.role, content: finalOf(m.content).slice(0, 8000) }));
  const askText = `${question}\n\n(${L.t} ${M})${IMG_NOTE}`;
  const ask = { role: 'user', content: imgs.length ? [...imgBlocks, { type: 'text', text: askText }] : askText };
  const msgs = [...past, ask];
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();

  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (o) => controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      let stored = '', finalText = '';
      try {
        const ctx = past.slice(-4).map((m) => `${m.role === 'user' ? 'Family' : 'Assistant'}: ${m.content.slice(0, 500)}`).join('\n');
        const plan = await route(key, question, ctx);
        if (!plan.two) {
          send({ type: 'naheed_stage', stage: 'single' });
          const txt = await callModel({ key, model: MODELS.has(model) ? model : 'claude-opus-5-5', system: [...base, { type: 'text', text: SINGLE }], messages: msgs, max_tokens: L.m,
            onText: (t) => send({ type: 'naheed_delta', stage: 'single', text: t }), onWeb: (u, t) => send({ type: 'naheed_web', url: u, title: t }),
            onSearch: () => send({ type: 'naheed_status', text: 'Checking current medical guidance on the web…' }) });
          stored = txt; finalText = txt;
        } else {
          send({ type: 'naheed_stage', stage: 'parallel', specialty: plan.specialty, title: plan.title });
          // The specialist and the senior doctor each form their own view at the same time, without seeing the other's.
          const [spec, blind] = await Promise.all([
            callModel({ key, model: 'claude-opus-5-5', system: [...base, { type: 'text', text: SPECIALIST(plan.specialty, plan.title) }], messages: msgs, max_tokens: L.m,
              onText: (t) => send({ type: 'naheed_delta', stage: 'specialist', text: t }), onWeb: (u, t) => send({ type: 'naheed_web', url: u, title: t }),
              onSearch: () => send({ type: 'naheed_status', text: `The ${plan.title} is checking current guidance…` }) }),
            callModel({ key, model: 'claude-fable-5-1', system: [...base, { type: 'text', text: SENIOR_BLIND(plan.specialty) }], messages: msgs, max_tokens: L.m,
              onText: (t) => send({ type: 'naheed_delta', stage: 'blind', text: t }), onWeb: (u, t) => send({ type: 'naheed_web', url: u, title: t }) }),
          ]);
          send({ type: 'naheed_stage', stage: 'senior' });
          const reviewText = `${question}\n\n(${L.t} ${M})${IMG_NOTE}\n\nYOUR OWN INDEPENDENT VIEW (written before reading the specialist):\n${blind}\n\nTHE ${plan.title.toUpperCase()}'S ANSWER TO REVIEW:\n${spec}`;
          const seniorMsgs = [...past, { role: 'user', content: imgs.length ? [...imgBlocks, { type: 'text', text: reviewText }] : reviewText }];
          while (seniorMsgs.length && seniorMsgs[0].role !== 'user') seniorMsgs.shift();
          const senior = await callModel({ key, model: 'claude-fable-5-1', system: [...base, { type: 'text', text: SENIOR(plan.specialty, plan.title) }], messages: seniorMsgs, max_tokens: L.m + 1500,
            onText: (t) => send({ type: 'naheed_delta', stage: 'senior', text: t }), onWeb: (u, t) => send({ type: 'naheed_web', url: u, title: t }),
            onSearch: () => send({ type: 'naheed_status', text: 'The senior doctor is checking current guidance…' }) });
          stored = `%%SPECIALIST:${plan.specialty}%%\n${spec}\n%%BLIND%%\n${blind}\n%%SENIOR%%\n${senior}`;
          finalText = finalOf(stored);
        }
        // Save the turn to the shared history, notify tagged people, then learn from it.
        let userId = null, assistantId = null;
        try {
          userId = (await db('chat_add', { role: 'user', content: question + (imgs.length ? `\n\n[Attached: ${imgs.length} images · ${label || 'scan'}]` : ''), asker: who || 'Family' })).id;
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
