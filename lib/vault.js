// Reads the encrypted data bundle shipped with the app (AES-256-GCM, key in DATA_KEY).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'data');
const cache = new Map();

function decrypt(buf) {
  const key = Buffer.from(process.env.DATA_KEY || '', 'hex');
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), body = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]);
}

export function readEncrypted(name) {
  if (cache.has(name)) return cache.get(name);
  const out = decrypt(fs.readFileSync(path.join(DIR, name)));
  if (out.length < 4_000_000) cache.set(name, out);
  return out;
}

export function readPlain(name) { return fs.readFileSync(path.join(DIR, name)); }

export function docFile(relPath) {
  return 'docs/' + crypto.createHash('sha1').update(relPath).digest('hex') + '.enc';
}

export function exists(name) { return fs.existsSync(path.join(DIR, name)); }

// Scan images live outside the function bundle as encrypted static files (public/i/<sha1>.enc).
// Only paths of her stored RadNet images are allowed; the server fetches the file and decrypts it.
export const IMG_PATH = /^radnet\/images\/[\w\-.]+\/[\w\-.]+\.jpg$/;
const imgCache = new Map();
export function imageUrl(rel) { return '/i/' + crypto.createHash('sha1').update(rel).digest('hex') + '.enc'; }
export async function readImage(rel, origin) {
  if (!IMG_PATH.test(rel) || rel.includes('..')) return null;
  if (imgCache.has(rel)) return imgCache.get(rel);
  const r = await fetch(origin + imageUrl(rel), { cache: 'no-store' });
  if (!r.ok) return null;
  const out = decrypt(Buffer.from(await r.arrayBuffer()));
  if (imgCache.size > 300) imgCache.clear();
  imgCache.set(rel, out);
  return out;
}
export function originOf(req) {
  const u = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || u.host;
  const proto = req.headers.get('x-forwarded-proto') || u.protocol.replace(':', '');
  return `${proto}://${host}`;
}
