// Files for a shared page: only the images and PDFs of the records in that link.
import { readEncrypted, docFile, exists, readImage, originOf, IMG_PATH } from '@/lib/vault';
import { buildShare, getShare } from '@/lib/share';

export const runtime = 'nodejs';
const nf = () => new Response('Not found', { status: 404 });

export async function GET(req, { params }) {
  const { token, path } = await params;
  const rel = path.join('/');
  if (rel.includes('..')) return nf();
  let share = null;
  try { share = await getShare(token, false); } catch {}
  if (!share) return nf();
  const { pdfs, folders } = await buildShare({ ...share, include_ai: false }); // AI text isn't needed to check file access
  const name = rel.split('/').pop();
  if (IMG_PATH.test(rel)) {
    if (![...folders].some((f) => rel.startsWith(f) && !rel.slice(f.length).includes('/'))) return nf();
    const img = await readImage(rel, originOf(req));
    if (!img) return nf();
    return new Response(img, { headers: { 'content-type': 'image/jpeg', 'content-disposition': `inline; filename="${name}"`, 'cache-control': 'private, max-age=3600' } });
  }
  if (!pdfs.has(rel) || !exists(docFile(rel))) return nf();
  return new Response(readEncrypted(docFile(rel)), { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${name}"`, 'cache-control': 'private, no-store' } });
}
