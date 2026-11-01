// Extracts family-reported updates from a finished chat turn into the notes log.
const PROMPT = `You keep the "learned from chats" log for a family health app about Naheed Saif (born Nov 1953).
You get the CURRENT NOTES (id, kind, text, date) and the LATEST EXCHANGE (the family's message and the assistant's reply).

Save only what the FAMILY said or confirmed in their message. Never save things only the assistant said, and never copy facts that come from her official records.
Kinds:
- health_update: how she is doing, symptoms, events, medicine changes the family reports.
- visit_report: what a doctor said or decided at a visit, as reported by the family.
- preference: how the family wants answers given.
- open_question: something to find out or ask a doctor that is still unresolved.
Rules:
- Text: one short sentence, third person, include the date if known (e.g. "Pain about 6/10 on 3 Nov; better since starting PT").
- needs_confirmation = true ONLY for important items: starting, stopping or changing a medicine; a new diagnosis; a procedure or surgery; an ER or hospital visit; a new allergy; a test result reported by the family. Everything else false.
- If the family corrects something already in the notes, use op "correct" with that note's id and the corrected text.
- If an open question in the notes is now answered, use op "resolve" with its id.
- Don't duplicate an existing note.
Return JSON only: {"actions":[{"op":"add","kind":"...","text":"...","note_date":"YYYY-MM-DD or empty","needs_confirmation":false} | {"op":"correct","id":"...","text":"..."} | {"op":"resolve","id":"..."}]}
Return {"actions":[]} when there is nothing to save.`;

export async function extractNotes({ key, notes, question, answer, today }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-5-5', max_tokens: 800,
      system: PROMPT + `\nToday is ${today}.`,
      messages: [{ role: 'user', content: `CURRENT NOTES:\n${JSON.stringify(notes.map((n) => ({ id: n.id, kind: n.kind, text: n.text, date: n.note_date, status: n.status })))}\n\nLATEST EXCHANGE\nFamily: ${question}\n\nAssistant: ${answer.slice(0, 6000)}` }],
    }),
  });
  if (!r.ok) return [];
  const j = await r.json();
  const t = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const ids = new Set(notes.map((n) => n.id));
    return (JSON.parse(m[0]).actions || []).filter((a) =>
      (a.op === 'add' && ['health_update', 'visit_report', 'preference', 'open_question'].includes(a.kind) && a.text) ||
      ((a.op === 'correct' || a.op === 'resolve') && ids.has(a.id))).slice(0, 6);
  } catch { return []; }
}

export function notesBlock(notes, chats) {
  const act = notes.filter((n) => n.status === 'active');
  const pend = notes.filter((n) => n.status === 'pending');
  const fmt = (n) => `- [${n.kind}] ${n.text}${n.note_date ? ` (dated ${n.note_date})` : ''} · saved ${String(n.created_at).slice(0, 10)}`;
  const recent = chats.slice(-16).map((m) => `${m.role === 'user' ? 'Family' : 'Assistant'} (${String(m.created_at).slice(0, 10)}): ${m.content.slice(0, 700)}`).join('\n');
  return `LEARNED FROM FAMILY CHATS (family-reported; NOT official records)
Use these to understand how things are progressing. They never replace the official record. If a note disagrees with the record, show both ("records say …", "family reported …") and suggest it as a question for her next visit. Apply any answer-style preferences.
Saved notes:
${act.length ? act.map(fmt).join('\n') : '- none yet'}
${pend.length ? `Awaiting family confirmation (treat as unconfirmed):\n${pend.map(fmt).join('\n')}` : ''}

Recent shared conversation (oldest first):
${recent || '- none yet'}`;
}
