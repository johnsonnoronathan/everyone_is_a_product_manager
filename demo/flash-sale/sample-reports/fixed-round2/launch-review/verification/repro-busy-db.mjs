// ARC-02 re-check and PERF-03 (adapted from round 1's repro/repro-busy-db.mjs). LOCAL instance only:
//   DB_LATENCY_MS=300 PORT=3100 PAYMENT_PORT=4200 node demo/flash-sale/run.mjs fixed
//   ADMIN_TOKEN=<local admin token> node repro-busy-db.mjs [paid|declined]
// Round 1 used anonymous /api/search to keep the pool busy; that route is gone, and unknown product ids
// no longer reach the database. This version floods with ONE signed-in shopper calling /api/my-orders,
// which is neither cached nor rate-limited. While the pool is busy:
//   - carol's payment is in flight: does she get her order (ARC-02)?
//   - dave tries to buy and a visitor loads the product page: what do they get (PERF-03)?
// mode "declined": the provider declines carol's card, so the release path runs under the flood.
import { call, show, login, buy, stats, reset, providerConfig, sleep } from './lib.mjs';

const mode = process.argv[2] ?? 'paid';
await reset(100);
await providerConfig({ hangRate: 0, declineRate: mode === 'declined' ? 1 : 0, minMs: 600, maxMs: 700 });
const carol = await login(`carol-${mode}@example.com`);
const dave = await login(`dave-${mode}@example.com`);
const mallory = await login(`mallory-${mode}@example.com`);
await call('GET', '/api/products/1'); // warm the product cache so carol goes straight to the reservation

const t0 = Date.now();
const carolBuy = buy(carol, '3 Carol Close, Springfield, IL 62701');
await sleep(320); // reservation done (300 ms query); payment now in flight
let flooding = true;
let sent = 0;
const floodStatuses = {};
const flood = (async () => {
  const inflight = [];
  while (flooding) {
    sent++;
    inflight.push(call('GET', '/api/my-orders', { token: mallory }).then((r) => (floodStatuses[r.status] = (floodStatuses[r.status] ?? 0) + 1), () => {}));
    await sleep(4);
  }
  await Promise.all(inflight);
})();
await sleep(1200);
const [daveBuy, page] = await Promise.all([buy(dave, '4 Dave Drive, Springfield, IL 62701'), call('GET', '/api/products/1')]);
const carolResult = await carolBuy;
flooding = false;
await flood;
show(`carol buy (${mode}) after ${Date.now() - t0} ms`, carolResult);
show('dave buy during the flood', daveBuy);
console.log(`product page during the flood -> ${page.status} ${page.status === 200 ? '(served)' : JSON.stringify(page.body)} after ${page.ms} ms`);
console.log(`flood: ${sent} GET /api/my-orders from one signed-in account ->`, JSON.stringify(floodStatuses));
await providerConfig({ declineRate: 0, minMs: 80, maxMs: 200 });
await sleep(1500);
show('carol my-orders', await call('GET', '/api/my-orders', { token: carol }));
show('carol retry buy', await buy(carol, '3 Carol Close, Springfield, IL 62701'));
console.log('admin stats ->', JSON.stringify(await stats()));
