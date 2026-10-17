// ARC-01 re-check (adapted from round 1's repro/repro-slow-payment.mjs): the payment provider answers
// right around the app's 3-second timeout. Run against a LOCAL instance (never production):
//   PAYMENT_MIN_MS=2985 PAYMENT_MAX_MS=3015 PORT=3100 PAYMENT_PORT=4200 node demo/flash-sale/run.mjs fixed
//   ADMIN_TOKEN=<local admin token> node repro-slow-payment.mjs [buyers]
// Round 1: 41 payments for 39 pairs after the shoppers told to "try again" did so.
// Round 2 expectation: timeouts answer 202 "confirming", the pair stays reserved, a retry is refused,
// and the reconciler settles every pending order so that provider charges == paid orders.
import { call, login, buy, stats, reset, sleep } from './lib.mjs';

const buyers = Number(process.argv[2] ?? 40);
await reset(100);
const tokens = await Promise.all(Array.from({ length: buyers }, (_, i) => login(`slow${i}@example.com`)));
const results = await Promise.all(tokens.map((t, i) => buy(t, `${i + 1} Slow Payment Street, Testville`)));
const tally = {};
for (const r of results) {
  const k = `${r.status} ${r.body?.status ?? r.body?.error}`;
  tally[k] = (tally[k] ?? 0) + 1;
}
console.log('first attempt:', JSON.stringify(tally));
console.log('stats right after:', JSON.stringify(await stats()));

// Shoppers told "confirming, don't pay again" try again anyway (the worst case).
const confirming = results.map((r, i) => (r.status === 202 ? i : -1)).filter((i) => i >= 0);
const again = await Promise.all(confirming.map((i) => buy(tokens[i], `${i + 1} Slow Payment Street, Testville`)));
const againTally = {};
for (const r of again) againTally[`${r.status} ${r.body?.error ?? r.body?.status}`] = (againTally[`${r.status} ${r.body?.error ?? r.body?.status}`] ?? 0) + 1;
console.log(`retry by the ${confirming.length} "confirming" shoppers:`, JSON.stringify(againTally));

// Wait for the reconciler (pending orders older than 5 s, checked every 5 s).
const t0 = Date.now();
let s;
do {
  await sleep(2000);
  s = await stats();
} while (s.pendingOrders > 0 && Date.now() - t0 < 60_000);
console.log(`after ${Math.round((Date.now() - t0) / 1000)} s:`, JSON.stringify(s));
const statuses = {};
for (const i of confirming) {
  const r = await call('GET', `/api/orders/${results[i].body.orderId}`, { token: tokens[i] });
  statuses[r.body.status] = (statuses[r.body.status] ?? 0) + 1;
}
console.log('orders of the "confirming" shoppers now:', JSON.stringify(statuses));
console.log(
  `=> provider charges ${s.payments.charges} (${s.payments.chargedCents / 100} USD) vs paid orders ${s.paidOrders}; ` +
    `pending ${s.pendingOrders}; stock remaining ${s.stockRemaining} of ${s.initialStock}; distinct paying customers ${s.distinctCustomers}`,
);
