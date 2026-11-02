// A tiny browser-like session for portal syncing: keeps cookies and follows redirects by hand.
export function session(base, ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36') {
  const jar = new Map();
  const store = (res) => {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    for (const c of list) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  async function go(url, opts = {}, hops = 0) {
    const u = new URL(url, base);
    const res = await fetch(u, { ...opts, redirect: 'manual', headers: { 'user-agent': ua, accept: opts.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9', ...(jar.size ? { cookie: cookie() } : {}), ...(opts.headers || {}) } });
    store(res);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location') && hops < 8) {
      const next = new URL(res.headers.get('location'), u).toString();
      return go(next, { method: 'GET', headers: { referer: u.toString() } }, hops + 1);
    }
    res.finalUrl = u.toString();
    return res;
  }
  return { go, jar };
}

// All inputs of the first form that has a password box: hidden fields (security tokens) come along automatically.
export function loginForm(html) {
  const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
  const f = forms.find((m) => /type\s*=\s*["']?password/i.test(m[2]));
  if (!f) return null;
  const action = (f[1].match(/action\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
  const fields = {}; let user = null, pass = null;
  for (const m of f[2].matchAll(/<input\b([^>]*)>/gi)) {
    const a = m[1], name = (a.match(/name\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!name) continue;
    const type = ((a.match(/type\s*=\s*["']?([\w-]+)/i) || [])[1] || 'text').toLowerCase();
    const value = (a.match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    if (type === 'password') pass = name;
    else if (['text', 'email'].includes(type) && (/^(user|login|email|username|userid)/i.test(name) || (!user && !/autocomplete|prevent|fix/i.test(name)))) { if (!user || /^(user|login|email)/i.test(name)) user = name; }
    if (['checkbox', 'radio'].includes(type) && !/checked/i.test(a)) continue;
    if (!['submit', 'button', 'image'].includes(type)) fields[name] = value.replace(/&amp;/g, '&');
  }
  return { action, fields, user, pass };
}

export const text = (html) => String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
