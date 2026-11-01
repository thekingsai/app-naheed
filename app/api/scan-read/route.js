// One-time AI review of each exam's stored images by two AI doctors, saved into her record.
import { getRole, getWho } from '@/lib/session';
import { readEncrypted, readImage, originOf } from '@/lib/vault';
import { db } from '@/lib/db';
import { json, deny } from '@/lib/http';
import { scanById, scans } from '@/lib/scanimages';

export const runtime = 'nodejs';
export const maxDuration = 600;

const SPEC = { MRI: 'musculoskeletal and spine MRI', CT: 'chest CT', 'X-ray': 'musculoskeletal and chest radiography', Mammogram: 'breast imaging', Ultrasound: 'thyroid and neck ultrasound', DEXA: 'bone densitometry' };

const COMMON = `Naming: always call yourselves "the AI Doctors" (or "the AI imaging specialist" / "the AI senior doctor"). "The radiologist" and "her doctor" mean only her real clinicians; keep their report and notes clearly separate from the AI Doctors' observations (for example "The radiologist's report says…; the AI Doctors also see…").
Honesty rules: describe only what you can actually see. Never soften a finding and never overcall one. Say how certain you are. You are looking at a limited set of JPEG key images exported from the patient portal (not the full study, no measuring tools, no window adjustment), so say plainly what cannot be judged. The radiologist's written report is the official reading; where you see something different, say so cautiously and suggest asking her doctor, rather than claiming the report is wrong. Never present an image observation as a diagnosis. Write in plain English with the clinical term in brackets where useful. Use **bold labels**, short paragraphs and bullets, no # headings.`;

const RADIOLOGIST = (kind) => `You are the AI imaging specialist, one of the app's AI Doctors, working as a senior consultant radiologist specialising in ${SPEC[kind] || 'diagnostic imaging'}. You are not her real radiologist. The family of your patient, Naheed (72), want an honest second look at the stored images of one of her exams. Her complete record is below for context, including the earlier reports of similar exams.
Write your read under these bold labels: **What the AI Doctors see**, **Against the radiologist's report** (the real report: what you can confirm, what these images don't show, anything that looks different), **Compared with earlier scans** (from the earlier reports in her record), **What can't be judged from these images**, **Worth asking her doctors**. About 350 words.
${COMMON}`;

const BLIND = (kind) => `You are the AI senior doctor, one of the app's AI Doctors, working as a chief of internal medicine with strong imaging experience. You are not one of her real doctors. Give your OWN independent read of the attached images of Naheed's exam, before seeing anyone else's read, with her whole record in mind (rheumatoid arthritis on Truxima, heart condition, osteoporosis, asthma and lung changes, neck nerve problems). The AI imaging specialist is reading the same images separately. Key observations, how they fit her history and the report, and your certainty. About 200 words.
${COMMON}`;

const REVIEW = `You are the AI senior doctor, one of the app's AI Doctors. You wrote an independent read of these images (below), and the AI imaging specialist wrote theirs. Compare them against the images, the real radiologist's official report and her whole record. Where you differ, decide who is right from what the images actually show, and say so.
Output exactly:
- 3 to 5 short bullets, each starting with "Agree:", "Differ:", "Correction:", "Adds:" or "Caution:".
- Then a line containing only %%FINAL%%
- Then the AI Doctors' final review, under these bold labels: **What the AI Doctors see**, **Against the radiologist's report**, **Compared with earlier scans**, **Limits of this review**, **Worth asking**. Plain English first, with the clinical terms in brackets. About 300 words.
${COMMON}`;

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
  const id = new URL(req.url).searchParams.get('id');
  try {
    const list = await db('scanread_list', { detail: id ? 'true' : 'false' });
    return json(id ? list.find((x) => x.scan_id === id) || null : list);
  } catch (e) { return json(id ? null : []); }
}

export async function POST(req) {
  if ((await getRole()) !== 'family') return deny();
  const who = await getWho();
  if (!['Imran', 'Salman'].includes(who)) return json({ error: { message: 'Only Imran or Salman can start an image review.' } }, 403);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: { message: 'The server has no API key.' } }, 428);
  const { scanId = '' } = await req.json().catch(() => ({}));
  const s = scanById(String(scanId));
  if (!s) return json({ error: { message: 'Unknown scan' } }, 404);

  const origin = originOf(req);
  const loaded = await Promise.all(s.paths.slice(0, 12).map(async (p) => [p, await readImage(p, origin).catch(() => null)]));
  const got = loaded.filter(([, b]) => b);
  if (!got.length) return json({ error: { message: 'The images for this exam could not be loaded.' } }, 500);
  const imgs = got.flatMap(([p, b]) => [{ type: 'text', text: `Image: ${p.split('/').slice(-2).join('/').replace('.jpg', '')}` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b.toString('base64') } }]);

  const others = scans().filter((x) => x.kind === s.kind && x.id !== s.id).map((x) => x.label).join('; ');
  const exam = `EXAM: ${s.label} at ${s.site}, ordered by ${s.dr}.
SERIES IN THE FULL STUDY: ${s.series.map((x) => `${x.label} (${x.n})`).join(', ')}. The ${got.length} attached images are key slices picked from it (file names give the series and slice number).
RADIOLOGIST'S REPORT: ${s.imp ? `Findings: ${s.find.join('; ')}. Conclusion: ${s.imp}` : 'Not posted yet. Read the images on their own and say the official report is still to come.'}
OTHER EXAMS OF THIS KIND IN HER RECORD: ${others || 'none'}.`;
  const record = readEncrypted('ask-context.txt.enc').toString();
  const sys = (role) => [{ type: 'text', text: "NAHEED'S COMPLETE RECORD:\n" + record, cache_control: { type: 'ephemeral', ttl: '1h' } }, { type: 'text', text: role }];

  try {
    const [radiologist, blind] = await Promise.all([
      ask(key, 'claude-opus-5-5', sys(RADIOLOGIST(s.kind)), [...imgs, { type: 'text', text: exam }], 3000),
      ask(key, 'claude-fable-5-1', sys(BLIND(s.kind)), [...imgs, { type: 'text', text: exam }], 2000),
    ]);
    const out = await ask(key, 'claude-fable-5-1', sys(REVIEW), [...imgs, { type: 'text', text: `${exam}\n\nYOUR OWN INDEPENDENT READ (written before seeing the AI imaging specialist's):\n${blind}\n\nTHE AI IMAGING SPECIALIST'S READ:\n${radiologist}` }], 3500);
    const i = out.indexOf('%%FINAL%%');
    const review = i >= 0 ? out.slice(0, i).trim() : '';
    const reading = i >= 0 ? out.slice(i + 9).trim() : out;
    await db('scanread_set', { scan_id: s.id, exam: s.label, reading, detail: JSON.stringify({ radiologist, blind, review }), images: got.length,
      model: 'claude-opus-5-5+claude-fable-5-1', by: who });
    return json({ ok: true, scan_id: s.id });
  } catch (e) {
    console.error('[scan-read]', s.id, e?.message);
    return json({ error: { message: `The review didn't finish: ${e?.message || 'unknown error'}` } }, 502);
  }
}
