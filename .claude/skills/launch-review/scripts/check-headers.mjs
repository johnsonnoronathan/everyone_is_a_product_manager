#!/usr/bin/env node
// Light, read-only checks against a running site the client owns (staging or production
// with permission): HTTPS redirect, security headers, cookie flags, CORS, and a few
// commonly exposed files. Sends about 10 GET requests in total.
//
//   node check-headers.mjs <url> [out.json]
import fs from 'node:fs';

const target = new URL(process.argv[2] ?? '');
const outFile = process.argv[3];
const results = [];
const add = (status, check, detail) => results.push({ status, check, detail });
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(target.hostname);

async function get(url, init = {}) {
  return fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000), ...init });
}

// 1. HTTP → HTTPS
if (target.protocol === 'https:') {
  const httpUrl = new URL(target);
  httpUrl.protocol = 'http:';
  try {
    const res = await get(httpUrl);
    const location = res.headers.get('location') ?? '';
    if ([301, 302, 307, 308].includes(res.status) && location.startsWith('https://')) add('PASS', 'HTTP redirects to HTTPS', `${res.status} → ${location}`);
    else add('FAIL', 'HTTP redirects to HTTPS', `http:// answered ${res.status} without redirecting to https://`);
  } catch (err) {
    add('INFO', 'HTTP redirects to HTTPS', `http:// not reachable (${err.cause?.code ?? err.message}); fine if port 80 is closed`);
  }
} else if (!isLocal) {
  add('FAIL', 'Uses HTTPS', 'The site was given as http://. Production sites must use HTTPS.');
}

// 2. Main page headers
const res = await fetch(target, { signal: AbortSignal.timeout(15_000) });
const h = res.headers;
add(res.ok ? 'PASS' : 'WARN', 'Page loads', `${res.status} ${res.url}`);

const csp = h.get('content-security-policy');
if (target.protocol === 'https:') {
  const hsts = h.get('strict-transport-security');
  add(hsts && /max-age=\d{7,}/.test(hsts) ? 'PASS' : 'WARN', 'Strict-Transport-Security (HSTS)', hsts ?? 'missing: browsers may connect over plain HTTP first');
}
add(csp ? 'PASS' : 'WARN', 'Content-Security-Policy', csp ? csp.slice(0, 120) : 'missing: no second line of defence against injected scripts (XSS)');
if (csp && /'unsafe-inline'|'unsafe-eval'|\*/.test(csp)) add('INFO', 'CSP strength', "CSP allows 'unsafe-inline', 'unsafe-eval' or wildcards, which weakens it");
add(h.get('x-content-type-options') === 'nosniff' ? 'PASS' : 'WARN', 'X-Content-Type-Options', h.get('x-content-type-options') ?? 'missing (should be "nosniff")');
const framing = h.get('x-frame-options') || (csp && /frame-ancestors/.test(csp) ? 'CSP frame-ancestors' : null);
add(framing ? 'PASS' : 'WARN', 'Clickjacking protection', framing ?? 'missing: other sites can embed this page in a frame (X-Frame-Options or CSP frame-ancestors)');
add(h.get('referrer-policy') ? 'PASS' : 'INFO', 'Referrer-Policy', h.get('referrer-policy') ?? 'missing: full URLs (with any tokens in them) may leak to other sites');
for (const header of ['server', 'x-powered-by']) {
  const v = h.get(header);
  if (v && /\d/.test(v)) add('INFO', `${header} header`, `"${v}" reveals software versions`);
}

// 3. Cookies
const cookies = typeof h.getSetCookie === 'function' ? h.getSetCookie() : [];
for (const cookie of cookies) {
  const name = cookie.split('=')[0];
  const missing = [];
  if (!/;\s*httponly/i.test(cookie)) missing.push('HttpOnly');
  if (!/;\s*secure/i.test(cookie) && !isLocal) missing.push('Secure');
  if (!/;\s*samesite=/i.test(cookie)) missing.push('SameSite');
  add(missing.length ? 'WARN' : 'PASS', `Cookie "${name}"`, missing.length ? `missing ${missing.join(', ')}` : 'HttpOnly, Secure, SameSite set');
}

// 4. CORS: does the site trust any origin with credentials?
try {
  const evil = 'https://cors-check.invalid';
  const cors = await fetch(target, { headers: { origin: evil }, signal: AbortSignal.timeout(10_000) });
  const allow = cors.headers.get('access-control-allow-origin');
  const creds = cors.headers.get('access-control-allow-credentials');
  if (allow === evil && creds === 'true') add('FAIL', 'CORS', 'Reflects any Origin AND allows credentials: any website can make logged-in requests and read the answers');
  else if (allow === evil) add('WARN', 'CORS', 'Reflects any Origin (without credentials). Check that no private data is served this way');
  else if (allow === '*') add('INFO', 'CORS', 'Access-Control-Allow-Origin: * on this page (OK for public content)');
  else add('PASS', 'CORS', allow ? `allows ${allow}` : 'no cross-origin access granted');
} catch (err) {
  add('INFO', 'CORS', `check failed: ${err.message}`);
}

// 5. Commonly exposed files (SPA fallbacks that return the HTML page are ignored)
const probes = [
  ['/.env', (t) => /^[A-Z0-9_]+=/m.test(t)],
  ['/.env.production', (t) => /^[A-Z0-9_]+=/m.test(t)],
  ['/.git/HEAD', (t) => /^ref: refs\//.test(t)],
  ['/.git/config', (t) => /\[core\]/.test(t)],
];
for (const [p, looksReal] of probes) {
  try {
    const r = await get(new URL(p, target));
    const text = r.ok ? (await r.text()).slice(0, 2000) : '';
    if (r.ok && !/text\/html/.test(r.headers.get('content-type') ?? '') && looksReal(text)) {
      add('FAIL', `Exposed ${p}`, `${p} is publicly downloadable: rotate any secrets in it and block the path`);
    } else add('PASS', `Not exposed: ${p}`, `${r.status}`);
  } catch (err) {
    add('INFO', `Probe ${p}`, `failed: ${err.message}`);
  }
}

const order = { FAIL: 0, WARN: 1, INFO: 2, PASS: 3 };
results.sort((a, b) => order[a.status] - order[b.status]);
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ url: target.href, checkedAt: new Date().toISOString(), results }, null, 2) + '\n');
console.log(`# Live checks: ${target.href}\n\n| Result | Check | Detail |\n|---|---|---|`);
for (const r of results) console.log(`| ${r.status} | ${r.check} | ${r.detail.replace(/\|/g, '\\|')} |`);
