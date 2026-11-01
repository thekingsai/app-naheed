// AI Doctors' insights for lab tests and visit days: what each one is about, and a fingerprint of its data
// so the app can tell when new results have arrived since the insight was written.
import crypto from 'node:crypto';
import { src } from '@/lib/share';

const FIELD = {
  Blood: ['Hematology', 'hematologist'], Kidneys: ['Nephrology', 'nephrologist'], Cholesterol: ['Cardiology and lipids', 'cardiologist'],
  Vitamins: ['Endocrinology and nutrition', 'endocrinologist'], Vitals: ['Internal medicine and cardiology', 'internist'],
  Immune: ['Rheumatology', 'rheumatologist'], Liver: ['Hepatology', 'hepatologist'], Bones: ['Endocrinology and bone health', 'endocrinologist'],
  Sugar: ['Endocrinology', 'endocrinologist'], Heart: ['Cardiology', 'cardiologist'], Thyroid: ['Endocrinology', 'endocrinologist'],
};
const hash = (o) => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 16);
const nice = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const noPaths = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'pdf' || k === 'file' ? undefined : v)));

export function insightItem(key) {
  const { d, r } = src();
  const m = String(key || '').match(/^(test|day):([\w-]{1,20})$/);
  if (!m) return null;
  if (m[1] === 'test') {
    const t = d.tests.find((x) => x.id === m[2]);
    if (!t) return null;
    const [sp, title] = FIELD[t.group] || ['Internal medicine', 'internist'];
    const data = { test: t.name, what: t.sub, unit: t.unit, normal_range: t.range, source: t.src, results: t.p.map((p) => [p[1], p[2]]), app_status: t.stl };
    return { key, kind: 'test', title: t.name, specialty: sp, specTitle: title, data, hash: hash(data.results) };
  }
  const iso = m[2];
  const visits = r.visits[iso] || [], labs = r.labs[iso] || [], lc = (r.labcorp || {})[iso] || null;
  if (!visits.length && !labs.length && !lc) return null;
  const data = noPaths({ date: iso, visits, medstar_labs_and_vitals: labs.map((x) => ({ test: x[0], value: x[1], unit: x[2], range: x[3], flag: x[4], vital: !!x[5] })),
    labcorp: lc && { ordered_by: lc.provider, practice: lc.practice, results: lc.rows.map((x) => ({ panel: x[0], test: x[1], value: x[2], unit: x[3], range: x[4], flag: x[5], comment: x[6] })) } });
  const v = visits[0];
  return { key, kind: 'day', iso, title: `${v ? (v.type ? v.type + ' visit' : 'Visit') : 'Lab results'} · ${nice(iso)}`, data, hash: hash(data) };
}

// Visit days and lab days in the last 12 months, newest first, plus every lab test
export function recentKeys(months = 12) {
  const { d, r } = src();
  const cut = new Date(); cut.setMonth(cut.getMonth() - months);
  const iso = cut.toISOString().slice(0, 10);
  const days = [...new Set([...Object.keys(r.visits), ...Object.keys(r.labs), ...Object.keys(r.labcorp || {})])].filter((x) => /^\d{4}-\d\d-\d\d$/.test(x) && x >= iso).sort().reverse();
  return [...days.map((x) => 'day:' + x), ...d.tests.map((t) => 'test:' + t.id)];
}
