// Reads an uploaded document (PDF or photo) and extracts exactly what it says, for the uploader to confirm.
import { readEncrypted } from '@/lib/vault';

const IMG = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function focusTitle() {
  try {
    const t = readEncrypted('ask-context.txt.enc').toString();
    const i = t.indexOf('"active"');
    const m = i >= 0 ? t.slice(i, i + 4000).match(/"title"\s*:\s*"([^"]+)"/) : null;
    return m ? m[1] : '';
  } catch { return ''; }
}

const PROMPT = (today, focus) => `You read a medical document uploaded to a private family health app for Naheed Saif (born 8 Nov 1953, female). Today is ${today}.
Extract exactly what the document says. Never guess, round or fill in missing values. If something is hard to read, list it under "unclear" instead of guessing.
Return JSON only, no other text:
{
 "kind": "lab" | "scan" | "visit" | "prescription" | "letter" | "bill" | "other",
 "title": "short plain title, e.g. Labcorp blood tests, MRI neck report, Pain clinic visit note",
 "date": "YYYY-MM-DD of the test, scan or visit (not the print date), or empty",
 "source": "lab, hospital or clinic name, or empty",
 "doctor": "ordering or signing doctor as printed, or empty",
 "patient": "patient name as printed, or empty",
 "is_naheed": "yes" | "no" | "unclear",
 "summary": "2 to 3 plain-English sentences on what it shows, honest and calm, for her sons",
 "plain": "one very simple, warm sentence for Naheed herself, e.g. This is your blood test from 12 November.",
 "values": [{"name": "", "value": "", "unit": "", "range": "", "flag": "high" | "low" | "abnormal" | ""}],
 "findings": ["key findings or the impression, short, in the document's words where possible"],
 "medicines": ["medicines started, stopped or changed, with dose, as written"],
 "followup": ["follow-up instructions or recommended tests"],
 "focus_related": true or false, whether it relates to her current main issue: ${focus || 'none'},
 "confidence": "high" | "medium" | "low",
 "unclear": ["parts that were hard to read"]
}
Limits: up to 80 values, 10 findings. Use empty arrays when not applicable.`;

export async function readUpload({ key, mime, data, today }) {
  let block;
  if (mime === 'application/pdf') block = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  else if (IMG.has(mime)) block = { type: 'image', source: { type: 'base64', media_type: mime, data } };
  else if (mime === 'text/plain') block = { type: 'text', text: 'DOCUMENT TEXT:\n' + Buffer.from(data, 'base64').toString('utf8').slice(0, 60000) };
  else return { error: 'This file type can’t be read. Please upload a PDF or a photo (JPG or PNG).' };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-opus-5-5', max_tokens: 6000,
      system: PROMPT(today, focusTitle()),
      messages: [{ role: 'user', content: [block, { type: 'text', text: 'Read this document and return the JSON.' }] }],
    }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    return { error: e?.error?.message || `Reading failed (${r.status})` };
  }
  const j = await r.json();
  const t = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) return { error: 'Couldn’t understand the document.' };
  try {
    const a = JSON.parse(m[0]);
    const arr = (x, n) => (Array.isArray(x) ? x.slice(0, n) : []);
    return { ai: {
      kind: String(a.kind || 'other'), title: String(a.title || 'Document'), date: /^\d{4}-\d{2}-\d{2}$/.test(a.date || '') ? a.date : '',
      source: String(a.source || ''), doctor: String(a.doctor || ''), patient: String(a.patient || ''),
      is_naheed: ['yes', 'no', 'unclear'].includes(a.is_naheed) ? a.is_naheed : 'unclear',
      summary: String(a.summary || ''), plain: String(a.plain || ''),
      values: arr(a.values, 80).map((v) => ({ name: String(v.name || ''), value: String(v.value ?? ''), unit: String(v.unit || ''), range: String(v.range || ''), flag: String(v.flag || '') })),
      findings: arr(a.findings, 10).map(String), medicines: arr(a.medicines, 20).map(String), followup: arr(a.followup, 10).map(String),
      focus_related: !!a.focus_related, confidence: ['high', 'medium', 'low'].includes(a.confidence) ? a.confidence : 'medium', unclear: arr(a.unclear, 10).map(String),
      read_at: new Date().toISOString(),
    } };
  } catch { return { error: 'Couldn’t understand the document.' }; }
}

// What Ask AI is told about uploads.
export function uploadsBlock(list) {
  const ok = (list || []).filter((u) => u.ai && ['review', 'confirmed', 'flagged'].includes(u.status));
  if (!ok.length) return 'UPLOADED DOCUMENTS (added by the family through the app)\n- none yet';
  const fmt = (u) => {
    const a = u.ai;
    const st = u.status === 'confirmed' ? `confirmed accurate by ${u.confirmed_by}` : u.status === 'flagged' ? `FLAGGED as wrong by ${u.confirmed_by}${u.feedback ? `: "${u.feedback}"` : ''} — don't rely on these values` : `not yet confirmed by ${u.uploaded_by}`;
    const vals = a.values.length ? `\n  Values: ${a.values.map((v) => `${v.name} ${v.value}${v.unit ? ' ' + v.unit : ''}${v.range ? ` (range ${v.range})` : ''}${v.flag ? ' ' + v.flag : ''}`).join('; ')}` : '';
    const fin = a.findings.length ? `\n  Findings: ${a.findings.join('; ')}` : '';
    const med = a.medicines.length ? `\n  Medicines: ${a.medicines.join('; ')}` : '';
    const fu = a.followup.length ? `\n  Follow-up: ${a.followup.join('; ')}` : '';
    return `- ${a.title}${a.date ? `, ${a.date}` : ''}${a.source ? `, ${a.source}` : ''} · uploaded by ${u.uploaded_by} ${String(u.created_at).slice(0, 10)} · ${st}${a.is_naheed !== 'yes' ? ` · patient name check: ${a.is_naheed}` : ''}\n  Summary: ${a.summary}${vals}${fin}${med}${fu}`;
  };
  return `UPLOADED DOCUMENTS (added by the family through the app; read by AI, then checked by the person who uploaded)
Treat confirmed uploads like records, citing them as "Uploaded <title> <date>". Treat unconfirmed ones as provisional and say so. Ignore values from flagged ones.
${ok.map(fmt).join('\n')}`;
}
