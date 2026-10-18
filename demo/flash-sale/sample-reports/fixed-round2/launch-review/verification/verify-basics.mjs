// Round-2 checks on a LOCAL instance started with the demo defaults:
//   PORT=3100 PAYMENT_PORT=4200 node demo/flash-sale/run.mjs fixed
//   ADMIN_TOKEN=<local admin token> TOKEN_SECRET=<local token secret> node verify-basics.mjs
// Covers SEC-02, SEC-03, ARC-03, ARC-04, OPS-02, PERF-01, PERF-02, OPS-05, OPS-06 and the new
// address-key and sale-schedule findings. Each section resets the demo data first.
import { base, call, show, login, idpToken, buy, stats, reset, saleSettings, sleep } from './lib.mjs';

const section = (t) => console.log(`\n=== ${t}`);

section('SEC-02 admin auth: wrong / missing token');
show('POST /api/admin/reset (no token)', await call('POST', '/api/admin/reset', { body: { stock: 1 } }));
show('POST /api/admin/sale (wrong token)', await call('POST', '/api/admin/sale', { headers: { 'x-admin-token': 'wrong' }, body: { paused: false } }));

section('Price and order privacy');
await reset();
const alice = await login('alice@example.com');
const bob = await login('bob@example.com');
const a1 = await buy(alice, '1 Apple Lane, Springfield, IL 62701', { price: 1 });
show('alice buys with price:1', a1);
show('bob reads alice order', await call('GET', `/api/orders/${a1.body.orderId}`, { token: bob }));
show('anonymous reads alice order', await call('GET', `/api/orders/${a1.body.orderId}`));
show('alice reads own order', await call('GET', `/api/orders/${a1.body.orderId}`, { token: alice }));

section('ARC-03 shipping address required before reserving');
await reset();
const carol = await login('carol@example.com');
show('buy without address', await buy(carol, undefined));
show('buy with "short"', await buy(carol, 'short'));
show('buy with address object', await buy(carol, { street: 'x' }));
console.log('stats after rejected buys:', JSON.stringify(await stats()));

section('SEC-03 one per customer: demo login vs identity-provider tokens, address variants');
await reset();
show('dana (test login) buys', await buy(await login('dana@example.com'), '12 Main Street, Springfield, IL 62701'));
show('dana+2 via TEST login, other address', await buy(await login('dana+2@example.com'), '99 Other Road, Shelbyville, IL 62565'));
show('dana+2 via IdP-format token, other address', await buy(idpToken('dana+2@example.com'), '99 Other Road, Shelbyville, IL 62565'));
show('Dana+3 via IdP-format token, same address spelled "12 Main St."', await buy(idpToken('Dana+3@example.com'), '12 Main St., Springfield, IL 62701'));
show('dana+4 via IdP-format token, same address exactly', await buy(idpToken('dana+4@example.com'), '12 Main Street, Springfield, IL 62701'));
console.log('stats:', JSON.stringify(await stats()));

section('New: address key drops every non-ASCII letter');
await reset();
show('customer A, Tokyo', await buy(await login('kenji@example.jp'), '東京都千代田区丸の内1-1-1'));
show('customer B, Osaka (different address)', await buy(await login('yuki@example.jp'), '大阪府大阪市北区梅田1-1-1'));
show('customer C, Moscow', await buy(await login('ivan@example.ru'), 'Москва, ул. Тверская, д. 7, кв. 12'));
show('customer D, St Petersburg (different address)', await buy(await login('olga@example.ru'), 'Санкт-Петербург, Невский пр., д. 7, кв. 12'));

section('ARC-04 / OPS-02 sale start and pause (orders untouched)');
await reset();
const erin = await login('erin@example.com');
show('erin buys while open', await buy(erin, '5 Elm Street, Springfield, IL 62701'));
const future = new Date(Date.now() + 3600_000).toISOString();
show(`admin sets startsAt ${future}`, await saleSettings({ startsAt: future }));
show('frank buys before start', await buy(await login('frank@example.com'), '6 Elm Street, Springfield, IL 62701'));
show('admin pauses', await saleSettings({ paused: true, startsAt: null }));
show('gina buys while paused', await buy(await login('gina@example.com'), '7 Elm Street, Springfield, IL 62701'));
show('erin my-orders while paused', await call('GET', '/api/my-orders', { token: erin }));
show('admin resumes', await saleSettings({ paused: false }));
show('gina buys after resume', await buy(await login('gina@example.com'), '7 Elm Street, Springfield, IL 62701'));

section('New: what the sale-settings endpoint accepts as an opening time');
for (const startsAt of ['2026-11-27', '2026-11-27T00:00:00', 'Nov 27', '1', 12345]) {
  const r = await saleSettings({ startsAt });
  console.log(`startsAt ${JSON.stringify(startsAt).padEnd(24)} -> ${r.status} stored ${r.body.startsAt} open=${r.body.open}`);
}
for (const paused of ['false', null, 'no']) {
  const r = await saleSettings({ paused });
  console.log(`paused ${JSON.stringify(paused).padEnd(8)} -> ${r.status} paused=${r.body.paused}`);
}
await saleSettings({ paused: false, startsAt: null });

section('PERF-01 anonymous paths that used to reach the database');
for (const p of ['/api/search?q=x', '/api/products/999999', '/api/products/abc', '/api/products/1']) show(`GET ${p}`, await call('GET', p));

section('OPS-05 / PERF-02 / OPS-06 health checks, keep-alive, caching');
for (const p of ['/healthz', '/readyz']) show(`GET ${p}`, await call('GET', p));
const page = await call('GET', '/');
const ver = /app\.js\?v=([0-9a-f]+)/.exec(page.body)?.[1];
for (const p of ['/', '/app.js', `/app.js?v=${ver}`, '/app.js?v=anything-at-all', '/api/products/1']) {
  const r = await fetch(`${base}${p}`);
  await r.arrayBuffer();
  console.log(`GET ${p.padEnd(32)} cache-control: ${r.headers.get('cache-control')} | keep-alive: ${r.headers.get('keep-alive')}`);
}
await sleep(10);
