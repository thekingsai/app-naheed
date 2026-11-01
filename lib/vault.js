// Reads the encrypted data bundle shipped with the app (AES-256-GCM, key in DATA_KEY).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'data');
const cache = new Map();

export function readEncrypted(name) {
  if (cache.has(name)) return cache.get(name);
  const buf = fs.readFileSync(path.join(DIR, name));
  const key = Buffer.from(process.env.DATA_KEY || '', 'hex');
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), body = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  const out = Buffer.concat([d.update(body), d.final()]);
  if (out.length < 4_000_000) cache.set(name, out);
  return out;
}

export function readPlain(name) { return fs.readFileSync(path.join(DIR, name)); }

export function docFile(relPath) {
  return 'docs/' + crypto.createHash('sha1').update(relPath).digest('hex') + '.enc';
}

export function exists(name) { return fs.existsSync(path.join(DIR, name)); }
