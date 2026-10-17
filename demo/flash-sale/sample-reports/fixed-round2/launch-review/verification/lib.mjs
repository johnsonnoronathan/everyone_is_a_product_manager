// Shared helpers for the round-2 verification scripts. LOCAL instance only (never production):
//   PORT=3100 PAYMENT_PORT=4200 node demo/flash-sale/run.mjs fixed
// Secrets of the local demo instance are passed in through the environment, never stored here:
//   ADMIN_TOKEN=<local admin token> node <script>.mjs
import crypto from 'node:crypto';

export const base = process.env.BASE ?? 'http://127.0.0.1:3100';
export const payment = process.env.PAYMENT ?? 'http://127.0.0.1:4200';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const adminToken = process.env.ADMIN_TOKEN;
export const admin = () => {
  if (!adminToken) {
    console.error('set ADMIN_TOKEN to the local instance admin token');
    process.exit(1);
  }
  return { 'x-admin-token': adminToken, 'content-type': 'application/json' };
};

export async function call(method, path, { token, body, headers = {}, url = base } = {}) {
  const t0 = Date.now();
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json ?? text, ms: Date.now() - t0, headers: res.headers };
}

export const show = (label, r) => console.log(`${label} -> ${r.status} ${JSON.stringify(r.body)}${r.ms > 500 ? ` (${r.ms} ms)` : ''}`);

// Test-only login stub (DEMO_LOGIN=1 on the local instance).
export async function login(email) {
  const r = await call('POST', '/api/login', { body: { email } });
  if (!r.body?.token) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token;
}

// A session token in the same format the production identity provider is expected to issue
// (payload.HMAC). Used to show what the buy endpoint does with an email the test stub would have
// normalised. Needs the LOCAL instance's TOKEN_SECRET in the environment.
export function idpToken(email) {
  const secret = process.env.TOKEN_SECRET;
  if (!secret) {
    console.error('set TOKEN_SECRET to the local instance token secret');
    process.exit(1);
  }
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + 3600_000 })).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

export const buy = (token, address, extra = {}) => call('POST', '/api/buy', { token, body: { productId: 1, address, ...extra } });
export const stats = async () => (await call('GET', '/api/admin/stats', { headers: admin() })).body;
export const reset = (stock = 100) => call('POST', '/api/admin/reset', { headers: admin(), body: { stock } });
export const saleSettings = (body) => call('POST', '/api/admin/sale', { headers: admin(), body });
export const providerConfig = (body) => call('POST', '/config', { url: payment, body });
