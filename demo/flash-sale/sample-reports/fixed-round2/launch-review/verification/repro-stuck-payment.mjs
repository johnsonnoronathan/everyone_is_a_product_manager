// ARC-10: a payment error that retrying can't fix is treated as "still confirming" forever.
// LOCAL only. The two processes run.mjs starts, started by hand so PAYMENT_URL can point at a path the
// provider doesn't serve (a stand-in for a wrong URL, a revoked key or any other permanent 4xx):
//   PAYMENT_PORT=4200 node demo/flash-sale/shared/fake-payment-provider.mjs &
//   PORT=3100 PAYMENT_URL=http://127.0.0.1:4200/v1 DEMO_LOGIN=1 ENABLE_TEST_ROUTES=1 SEED_DEMO_DATA=1 \
//     PAYMENT_SECRET_KEY=… TOKEN_SECRET=… ADMIN_TOKEN=… node demo/flash-sale/fixed/server.mjs &
//   ADMIN_TOKEN=<local admin token> node repro-stuck-payment.mjs
import { call, show, login, buy, stats, sleep } from './lib.mjs';

await call('POST', '/api/admin/reset', { headers: { 'x-admin-token': process.env.ADMIN_TOKEN, 'content-type': 'application/json' }, body: { stock: 3 } });
const shoppers = await Promise.all(['ann', 'ben', 'cat'].map((n) => login(`${n}@example.com`)));
const first = await Promise.all(shoppers.map((t, i) => buy(t, `${i + 1} Stuck Street, Springfield, IL 62701`)));
first.forEach((r, i) => show(`shopper ${i + 1} buys`, r));
show('a fourth shopper tries', await buy(await login('dan@example.com'), '4 Stuck Street, Springfield, IL 62701'));
for (const wait of [15, 30]) {
  await sleep(wait === 15 ? 15_000 : 15_000);
  console.log(`after ${wait} s: stats ${JSON.stringify(await stats())}`);
}
for (const [i, r] of first.entries()) show(`shopper ${i + 1} order`, await call('GET', `/api/orders/${r.body.orderId}`, { token: shoppers[i] }));
show('shopper 1 retries', await buy(shoppers[0], '1 Stuck Street, Springfield, IL 62701'));
