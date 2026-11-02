// Advanced Radiology (RadNet) patient portal: sign in with her saved login, list exams, fetch new report PDFs.
import { session, loginForm, text } from '@/lib/portals/session';

const BASE = 'https://myradnetpatientportal.com/';
const PENDING = /report becomes available|report is not yet available/i;

export async function radnetCheck({ known }) {
  const user = process.env.RADNET_USER, pass = process.env.RADNET_PASS;
  if (!user || !pass) return { ok: false, error: 'The RadNet login isn\'t saved on the server yet.' };
  const s = session(BASE);
  const home = await s.go(BASE);
  const homeHtml = await home.text();
  const form = loginForm(homeHtml);
  if (!form || !form.user || !form.pass) {
    // what the server saw, without any values, so the sign-in step can be fixed
    const names = [...homeHtml.matchAll(/<input\b[^>]*name\s*=\s*["']([^"']+)["'][^>]*>/gi)].map((m) => m[1]).slice(0, 20);
    const hint = `status ${home.status} at ${home.finalUrl} · ${homeHtml.length} chars · forms ${(homeHtml.match(/<form/gi) || []).length} · inputs ${names.join(',')} · ${text(homeHtml).slice(0, 120)}`;
    return { ok: false, error: 'Couldn\'t find the RadNet sign-in form (the portal may have changed).', hint };
  }
  const body = new URLSearchParams({ ...form.fields, [form.user]: user, [form.pass]: pass });
  const after = await s.go(form.action || BASE, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE.slice(0, -1), referer: BASE } });
  let html = await after.text();
  if (!/\/Exam\/S\^/.test(html)) { const ex = await s.go('/Exam'); html = await ex.text(); }
  if (!/\/Exam\/S\^/.test(html)) {
    const t = text(html).slice(0, 300);
    if (/verif|code|captcha|robot/i.test(t)) return { ok: false, error: 'RadNet asked for an extra check (code or "are you human"), so the server can\'t sign in.' };
    return { ok: false, error: 'RadNet didn\'t accept the saved login, or the page changed.', hint: t.slice(0, 160) };
  }
  // exam list: link to /Exam/S^id with the exam name and date as the link text
  const exams = [];
  for (const m of html.matchAll(/href="\/Exam\/(S\^\d+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = text(m[2]).replace(/\s+/g, ' ').trim();
    if (label && !exams.some((e) => e.id === m[1])) exams.push({ id: m[1], label });
  }
  const results = [];
  for (const e of exams.slice(0, 40)) {
    const page = await (await s.go('/Exam/' + e.id)).text();
    const acc = (page.match(/DiagnosticReport(?:PDF)?\/(\d{6,})/) || page.match(/accession[^0-9]{0,40}(\d{7,})/i) || [])[1];
    if (!acc) { results.push({ ...e, status: 'no-accession' }); continue; }
    if (known.has(acc)) { results.push({ ...e, acc, status: 'have' }); continue; }
    const rep = await s.go('/Exam/DiagnosticReport/' + acc, { method: 'POST', headers: { 'x-requested-with': 'XMLHttpRequest', referer: BASE + 'Exam/' + e.id } });
    const repHtml = await rep.text();
    if (PENDING.test(repHtml) || !/IMPRESSION|FINDINGS|View as PDF/i.test(repHtml)) { results.push({ ...e, acc, status: 'pending' }); continue; }
    const pdf = await s.go('/Exams/DiagnosticReportPDF/' + acc, { accept: 'application/pdf,*/*' });
    const buf = Buffer.from(await pdf.arrayBuffer());
    if (!/pdf/i.test(pdf.headers.get('content-type') || '') || buf.length < 2000) { results.push({ ...e, acc, status: 'report-text-only', text: text(repHtml).slice(0, 20000) }); continue; }
    results.push({ ...e, acc, status: 'new', pdf: buf.toString('base64'), size: buf.length });
  }
  return { ok: true, exams: exams.length, results };
}
