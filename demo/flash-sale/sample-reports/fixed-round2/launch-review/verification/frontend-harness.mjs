// Runs the real browser script (demo/flash-sale/shared/public/app.js) in Node with a minimal DOM stub,
// against a LOCAL instance, to check what the page does. Not a browser: no rendering, no HTTP cache.
//   node frontend-harness.mjs countdown <seconds>   count requests the page makes while "opens at …" is shown
//   node frontend-harness.mjs busy                  first two product loads answer 503 (ARC-08)
//   node frontend-harness.mjs expired               buy with an expired/invalid session (ARC-08)
import vm from 'node:vm';
import fs from 'node:fs';
import { base } from './lib.mjs';

const mode = process.argv[2] ?? 'countdown';
const seconds = Number(process.argv[3] ?? 3);
const appJs = fs.readFileSync(new URL('../../../../shared/public/app.js', import.meta.url), 'utf8');

const elements = {};
const el = (id) =>
  (elements[id] ??= {
    id, textContent: '', hidden: false, disabled: false, value: '', listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    replaceChildren(...children) { this.children = children; },
  });
const store = {};
const sessionStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = String(v)), removeItem: (k) => delete store[k] };
const warnings = [];
process.on('warning', (w) => warnings.push(`${w.name}: ${w.message.split('\n')[0]}`));

const requests = {};
let productLoads = 0;
const countingFetch = (url, options) => {
  requests[url] = (requests[url] ?? 0) + 1;
  if (mode === 'busy' && url.startsWith('/api/products/') && ++productLoads <= 2) {
    return Promise.resolve(new Response('{"error":"We are very busy. Please try again."}', { status: 503 }));
  }
  return fetch(new URL(url, base), options);
};

if (mode === 'expired') {
  store.token = 'eyJlbWFpbCI6ImV4cGlyZWRAZXhhbXBsZS5jb20iLCJleHAiOjF9.invalid-signature';
  store.email = 'expired@example.com';
}

const context = vm.createContext({ document: { getElementById: el, createElement: () => ({ textContent: '' }) }, sessionStorage, fetch: countingFetch, setTimeout, clearTimeout, AbortSignal, console });
vm.runInContext(appJs, context, { filename: 'app.js' });

const snapshot = (label) =>
  console.log(`${label}: name="${el('name').textContent}" sale-status="${el('sale-status').textContent}" buy="${el('buy').textContent}" disabled=${el('buy').disabled} message="${el('message').textContent}" login-form.hidden=${el('login-form').hidden}`);

if (mode === 'countdown') {
  await new Promise((r) => setTimeout(r, seconds * 1000));
  snapshot(`after ${seconds} s`);
  const total = Object.values(requests).reduce((a, b) => a + b, 0);
  console.log(`requests in ${seconds} s: ${JSON.stringify(requests)} (${Math.round(total / seconds)} per second from one open page)`);
} else if (mode === 'busy') {
  await new Promise((r) => setTimeout(r, 300));
  snapshot('after first 503');
  await new Promise((r) => setTimeout(r, 4500));
  snapshot('after backoff retries');
  console.log(`requests: ${JSON.stringify(requests)}`);
} else if (mode === 'expired') {
  await new Promise((r) => setTimeout(r, 500));
  snapshot('signed in (stored token)');
  el('address').value = '1 Expired Street, Springfield, IL 62701';
  await el('buy').listeners.click();
  snapshot('after clicking Buy');
  console.log(`token still stored: ${store.token !== undefined}`);
}
console.log(warnings.length ? `Node warnings: ${[...new Set(warnings)].join(' | ')}` : 'Node warnings: none');
process.exit(0);
