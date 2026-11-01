// Her stored scan images (all RadNet exams), which Ask AI and the image review can look at.
import { readEncrypted } from '@/lib/vault';

let LIST = null;
export function scans() {
  if (!LIST) {
    LIST = JSON.parse(readEncrypted('scans.json.enc').toString())
      .map((s) => ({ ...s, label: `${s.name} · ${s.date}`, t: Date.parse(s.date) || 0, paths: s.keys.map((k) => s.base + k + '.jpg') }))
      .sort((a, b) => b.t - a.t);
  }
  return LIST;
}
export function scanById(id) { return scans().find((s) => s.id === id) || null; }

const KINDS = [
  [/\bmri\b|\bmr\b|magnetic/i, 'MRI'],
  [/x-?rays?|radiograph/i, 'X-ray'],
  [/\bcta?\b|cat scan|angiogram/i, 'CT'],
  [/mammo/i, 'Mammogram'],
  [/ultrasound|sonogram/i, 'Ultrasound'],
  [/dexa|bone density/i, 'DEXA'],
];
const PARTS = [/neck|cervical/i, /shoulder/i, /chest|lung/i, /knee/i, /\bfoot|\bfeet/i, /hand|wrist/i, /spine|back/i, /thyroid/i, /breast/i];
const MORE = /compar|chang|trend|over time|previous|prior|earlier|older|all (the|her)|progress|history|since/i;

// Picks images for a question typed straight into Ask AI (no images attached from a scan page).
export function autoImages(question) {
  const q = String(question || '');
  if (!/\b(mri|mr|x-?rays?|scans?|images?|radiographs?|films?|cta?|cat scan|angiogram|mammo\w*|ultrasounds?|sonograms?|dexa|bone density)\b/i.test(q)) return { paths: [], label: '' };
  const all = scans();
  const kinds = KINDS.filter(([re]) => re.test(q)).map(([, k]) => k);
  let picks = kinds.length ? all.filter((s) => kinds.includes(s.kind)) : all;
  const parts = PARTS.filter((re) => re.test(q));
  if (parts.length) { const p = picks.filter((s) => parts.some((re) => re.test(s.name))); if (p.length) picks = p; }
  if (/\bleft\b/i.test(q) && !/\bright\b/i.test(q)) { const p = picks.filter((s) => /left/i.test(s.name)); if (p.length) picks = p; }
  if (/\bright\b/i.test(q) && !/\bleft\b/i.test(q)) { const p = picks.filter((s) => /right/i.test(s.name)); if (p.length) picks = p; }
  const years = q.match(/\b20[12]\d\b/g);
  if (years) { const p = picks.filter((s) => years.some((y) => s.date.includes(y))); if (p.length) picks = p; }
  if (!picks.length) return { paths: [], label: '' };
  // Most recent exam (all exams from that day, e.g. the two X-rays); comparisons get up to three dates.
  const dates = [...new Set(picks.map((s) => s.t))].slice(0, MORE.test(q) ? 3 : 1);
  picks = picks.filter((s) => dates.includes(s.t)).slice(0, 4);
  const per = Math.max(2, Math.floor(12 / picks.length));
  const paths = picks.flatMap((s) => s.paths.slice(0, per)).slice(0, 12);
  return { paths, label: picks.map((s) => s.label).join(' + ') };
}

export function imagesKnown() {
  return `SCAN IMAGES ON FILE: besides the written reports, the app stores the actual images for every RadNet exam: ${scans().map((s) => `${s.label} (${s.count} images)`).join('; ')}. The 30 Oct 2026 MRI images are on file even though the radiologist's written report has not been posted yet. When images are attached to a question, look at them. When they are not attached and the question needs them, say the family can open the scan in the app and tap "Ask AI about these images", or name the exam (for example "the 2024 CT chest") in the question. Never say the MRI hasn't been received when only the written report is missing. AI IMAGE REVIEWS (below the record, when present) are earlier AI observations of these images, not radiology reads; use them, but the radiologist's report is the official reading.`;
}

export function readsBlock(reads) {
  if (!reads?.length) return 'AI IMAGE REVIEWS: none yet.';
  const by = new Map(scans().map((s) => [s.id, s]));
  return 'AI IMAGE REVIEWS (two AI doctors looked at the stored images of each exam; AI observations, not radiology reads; the radiologist\'s report is official):\n\n' +
    reads.map((r) => `### ${by.get(r.scan_id)?.label || r.exam} (reviewed ${String(r.created_at).slice(0, 10)}, ${r.images} images)\n${r.reading}`).join('\n\n');
}
