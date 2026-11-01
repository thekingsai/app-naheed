// Her stored scan images that Ask AI can look at, and the key slices to send for each.
export const SCAN_IMAGES = [
  { label: 'MRI neck (cervical spine) · 30 Oct 2026', match: /\bmri\b|\bmr\b|magnetic/i, base: 'radnet/images/2026-10-30-mri-cervical-spine/',
    keys: ['s2-SAG-T2-CS-006', 's2-SAG-T2-CS-007', 's2-SAG-T2-CS-008', 's4-SAG-STIR-CS-007', 's3-SAG-T1-CS-007', 's6-AX-T2-CS-017', 's6-AX-T2-CS-019', 's6-AX-T2-CS-021', 's6-AX-T2-CS-023', 's6-AX-T2-CS-025', 's6-AX-T2-CS-027', 's6-AX-T2-CS-029'] },
  { label: 'X-ray neck (cervical spine) · 13 Oct 2026', match: /x-?rays?|radiograph/i, also: /neck|cervical|spine/i, base: 'radnet/images/2026-10-13-xray-cervical-spine/',
    keys: ['s1-CR-001', 's1-CR-002', 's1-CR-003', 's1-CR-004'] },
  { label: 'X-ray left shoulder · 13 Oct 2026', match: /x-?rays?|radiograph/i, also: /shoulder/i, base: 'radnet/images/2026-10-13-xray-shoulder-left/',
    keys: ['s1-CR-001', 's1-CR-002'] },
];

// Picks images for a question typed straight into Ask AI (no images attached from a scan page).
export function autoImages(question) {
  const q = String(question || '');
  if (!/\b(mri|mr|x-?rays?|scans?|images?|radiograph|films?)\b/i.test(q)) return { paths: [], label: '' };
  let picks = SCAN_IMAGES.filter((s) => s.match.test(q) && (!s.also || s.also.test(q)));
  // "the X-rays" without saying which one means both X-rays
  if (/x-?rays?/i.test(q) && !picks.some((s) => /X-ray/.test(s.label))) picks = [...picks, ...SCAN_IMAGES.filter((s) => /X-ray/.test(s.label))];
  if (!picks.length) picks = [SCAN_IMAGES[0]];
  const per = Math.max(2, Math.floor(12 / picks.length));
  const paths = picks.flatMap((s) => s.keys.slice(0, per).map((k) => s.base + k + '.jpg')).slice(0, 12);
  return { paths, label: picks.map((s) => s.label).join(' + ') };
}

export const IMAGES_KNOWN = `SCAN IMAGES ON FILE: besides the written reports, the app stores the actual images for: ${SCAN_IMAGES.map((s) => s.label).join('; ')}. The 30 Oct MRI images are on file even though the radiologist's written report has not been posted yet. When images are attached to a question, look at them. When they are not attached and the question needs them, say the family can open the scan in the app and tap "Ask AI about these images", or mention the MRI or X-ray by name in the question. Never say the MRI hasn't been received when only the written report is missing.`;
