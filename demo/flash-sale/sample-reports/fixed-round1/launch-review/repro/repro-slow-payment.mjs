// Reproduction for "a payment that takes ~3 s is treated as failed even when the provider charged".
// Run against a LOCAL instance (never production) started with
//   PAYMENT_MIN_MS=2985 PAYMENT_MAX_MS=3015 PORT=3100 PAYMENT_PORT=4200 node demo/flash-sale/run.mjs fixed
// i.e. PAYMENT_MIN_MS=2985 PAYMENT_MAX_MS=3015 (provider
// answers right around the app's 3-second timeout). Usage: node repro-slow-payment.mjs <base> <buyers>
const base = process.argv[2] ?? 'http://127.0.0.1:3100';
const buyers = Number(process.argv[3] ?? 40);
// Admin token of the LOCAL demo instance (run.mjs default), passed in so it is not stored here.
const admin = { 'x-admin-token': process.env.ADMIN_TOKEN ?? (console.error('set ADMIN_TOKEN'), process.exit(1)) };
const j = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });

await fetch(`${base}/api/admin/reset`, { method: 'POST', headers: { ...admin, 'content-type': 'application/json' }, body: '{"stock":100}' });
const tokens = await Promise.all(
  Array.from({ length: buyers }, async (_, i) => (await (await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ email: `slow${i}@example.com` }) })).json()).token),
);
const results = await Promise.all(
  tokens.map((t) => fetch(`${base}/api/buy`, { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: '{"productId":1}' }).then(j)),
);
const tally = {};
for (const r of results) tally[`${r.status} ${r.body?.error ?? 'ok'}`] = (tally[`${r.status} ${r.body?.error ?? 'ok'}`] ?? 0) + 1;
console.log('buy results:', JSON.stringify(tally));
const stats = (await j(await fetch(`${base}/api/admin/stats`, { headers: admin }))).body;
console.log('admin stats:', JSON.stringify(stats));
console.log(`=> provider charges ${stats.payments.charges} vs paid orders ${stats.paidOrders}: ${stats.payments.charges - stats.paidOrders} customer(s) charged while the app told them the payment failed and put the pair back on sale`);

// Part 2: every shopper who was told "Payment did not go through. Please try again." does exactly that.
let pending = tokens.filter((_, i) => results[i].status === 503);
for (let round = 1; round <= 6 && pending.length; round++) {
  const again = await Promise.all(pending.map((t) => fetch(`${base}/api/buy`, { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: '{"productId":1}' }).then(j)));
  pending = pending.filter((_, i) => again[i].status === 503);
}
const after = (await j(await fetch(`${base}/api/admin/stats`, { headers: admin }))).body;
console.log('after retries:', JSON.stringify(after));
console.log(`=> ${after.distinctCustomers} of ${buyers} shoppers hold exactly one paid order; provider took ${after.payments.charges} payments (${after.payments.chargedCents / 100} USD) for ${after.paidOrders} pairs; ${pending.length} shoppers never succeeded`);
