// Reproduction for "writes after the payment call give up when the DB pool is busy".
// Run against a LOCAL instance (never production) started with
//   DB_LATENCY_MS=300 PORT=3100 PAYMENT_PORT=4200 node demo/flash-sale/run.mjs fixed
// i.e. DB_LATENCY_MS=300 (the normal
// 10-connection pool, with queries slowed down the way a database under peak load slows down). Usage: node repro-busy-db.mjs <base> <mode>
//   mode "paid":    payment succeeds, then the "mark paid" UPDATE has to wait for a connection
//   mode "release": payment hangs (provider hangRate=1), then the "release stock" transaction waits
const base = process.argv[2] ?? 'http://127.0.0.1:3100';
const mode = process.argv[3] ?? 'paid';
const payment = process.argv[4] ?? 'http://127.0.0.1:4200';
// Admin token of the LOCAL demo instance (run.mjs default), passed in so it is not stored here.
const admin = { 'x-admin-token': process.env.ADMIN_TOKEN ?? (console.error('set ADMIN_TOKEN'), process.exit(1)) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });

await fetch(`${base}/api/admin/reset`, { method: 'POST', headers: { ...admin, 'content-type': 'application/json' }, body: '{"stock":100}' });
await fetch(`${payment}/config`, { method: 'POST', body: JSON.stringify({ hangRate: mode === 'release' ? 1 : 0 }) });
const email = `carol-${mode}@example.com`;
const { token } = await (await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ email }) })).json();
const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
await fetch(`${base}/api/products/1`); // warm the 1-second product cache so the buy goes straight to the reservation

const t0 = Date.now();
const buy = fetch(`${base}/api/buy`, { method: 'POST', headers: auth, body: '{"productId":1}' }).then(j);
// Let the reservation transaction finish (300 ms), then keep the pool busy with ordinary
// anonymous traffic while the payment call is in flight.
await sleep(mode === 'release' ? 3150 : 310);
let flooding = true;
const flood = (async () => {
  const inflight = [];
  while (flooding) {
    inflight.push(fetch(`${base}/api/search?q=x`).catch(() => {}));
    await sleep(4);
  }
  await Promise.all(inflight);
})();
const result = await buy;
flooding = false;
await flood;
console.log(`buy -> ${result.status} ${JSON.stringify(result.body)} after ${Date.now() - t0} ms`);
await sleep(1500);
await fetch(`${payment}/config`, { method: 'POST', body: JSON.stringify({ hangRate: 0 }) });
console.log('my-orders ->', JSON.stringify((await j(await fetch(`${base}/api/my-orders`, { headers: auth }))).body));
const retry = await j(await fetch(`${base}/api/buy`, { method: 'POST', headers: auth, body: '{"productId":1}' }));
console.log(`retry buy -> ${retry.status} ${JSON.stringify(retry.body)}`);
const stats = await j(await fetch(`${base}/api/admin/stats`, { headers: admin }));
console.log('admin stats ->', JSON.stringify(stats.body));
