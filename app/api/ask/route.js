import { getRole, getWho } from '@/lib/session';
import { readEncrypted, readPlain } from '@/lib/vault';
import { db } from '@/lib/db';
import { json, deny } from '@/lib/http';
import { extractNotes, notesBlock } from '@/lib/learn';

export const runtime = 'nodejs';
export const maxDuration = 300;

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

  let notes = [], chats = [];
  try { [notes, chats] = await Promise.all([db('notes_list', {}), db('chat_list', { limit: 30 })]); } catch {}

  const rules = readPlain('system-prompt.md').toString().replace('{{TODAY}}', today).replace('{{ASKER}}', who ? `${who}, one of Naheed's sons` : 'a family member (Imran or his brother Salman)');
  const record = readEncrypted('ask-context.txt.enc').toString();
  const msgs = [
    ...history.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-12)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) })),
    { role: 'user', content: `${question}\n\n(${L.t} ${M})` },
  ];
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODELS.has(model) ? model : 'claude-opus-5-5',
      max_tokens: L.m, stream: true,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      system: [
        { type: 'text', text: rules },
        { type: 'text', text: "NAHEED'S COMPLETE RECORD:\n" + record, cache_control: { type: 'ephemeral', ttl: '1h' } },
        { type: 'text', text: notesBlock(notes, chats) },
      ],
      messages: msgs,
    }),
  });
  if (!upstream.ok) {
    const e = await upstream.json().catch(() => ({}));
    return json({ error: { message: e?.error?.message || `Model error ${upstream.status}` } }, 502);
  }

  const enc = new TextEncoder(), dec = new TextDecoder();
  let answer = '', buf = '';
  const body = new ReadableStream({
    async start(controller) {
      const rd = upstream.body.getReader();
      try {
        while (true) {
          const { done, value } = await rd.read();
          if (done) break;
          controller.enqueue(value);
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const ev = buf.slice(0, i); buf = buf.slice(i + 2);
            const line = ev.split('\n').find((x) => x.startsWith('data: '));
            if (!line) continue;
            try { const j = JSON.parse(line.slice(6)); if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') answer += j.delta.text; } catch {}
          }
        }
        // Save the turn to the shared history, then learn from it.
        let userId = null;
        try {
          userId = (await db('chat_add', { role: 'user', content: question, asker: who || 'Family' })).id;
          await db('chat_add', { role: 'assistant', content: answer || '(no answer)', model, asker: 'Assistant' });
        } catch {}
        let result = [];
        try {
          const actions = await extractNotes({ key, notes, question, answer, today });
          if (actions.length) result = await db('notes_apply', { actions: actions.map((a) => ({ ...a, source_message: userId || '', by: 'Family' })) });
        } catch {}
        const ev = {
          type: 'naheed_notes',
          saved: result.filter((x) => x.op === 'add' && !x.pending),
          pending: result.filter((x) => x.op === 'add' && x.pending),
          corrected: result.filter((x) => x.op === 'correct'),
        };
        controller.enqueue(enc.encode(`event: naheed_notes\ndata: ${JSON.stringify(ev)}\n\n`));
      } catch (e) {
        controller.enqueue(enc.encode(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { message: 'The answer was cut off. Please try again.' } })}\n\n`));
      } finally { controller.close(); }
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' } });
}
