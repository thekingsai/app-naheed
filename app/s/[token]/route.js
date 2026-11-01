// A shared page for friends and family who are doctors: only the records picked for this link.
import { readEncrypted } from '@/lib/vault';
import { buildShare, getShare } from '@/lib/share';

export const runtime = 'nodejs';

const page = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' } });
const gone = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Link not available</title><style>body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f6f8fc;color:#1f1f1f}div{max-width:420px;padding:24px;text-align:center}@media(prefers-color-scheme:dark){body{background:#131314;color:#e3e3e3}}</style></head><body><div><h1 style="font-size:22px">This link isn't available</h1><p>It may have been turned off. Ask the person who sent it for a new one.</p></div></body></html>`;

export async function GET(req, { params }) {
  const { token } = await params;
  let share = null;
  try { share = await getShare(token, true); } catch {}
  if (!share) return page(gone, 404);
  const { page: data } = await buildShare(share);
  const html = readEncrypted('share.html.enc').toString().replace('{{SHARE}}', JSON.stringify(data).replace(/</g, '\\u003c'));
  return page(html);
}
