// ARC-09 re-check: a pair released by a declined payment is offered again. LOCAL instance only:
//   PORT=3100 PAYMENT_PORT=4200 node demo/flash-sale/run.mjs fixed
//   ADMIN_TOKEN=<local admin token> node repro-returned-pair.mjs
import { call, show, login, buy, stats, reset, providerConfig, sleep } from './lib.mjs';

await reset(1);
await providerConfig({ declineRate: 1, minMs: 1500, maxMs: 1600 });
const ann = await login('ann-returned@example.com');
const ben = await login('ben-returned@example.com');
const annBuy = buy(ann, '1 Returned Road, Springfield, IL 62701');
await sleep(300);
show('ben while the only pair is reserved by ann', await buy(ben, '2 Returned Road, Springfield, IL 62701'));
show('ann (card declined)', await annBuy);
await providerConfig({ declineRate: 0, minMs: 80, maxMs: 200 });
const page = await call('GET', '/api/products/1');
console.log(`product page right after the decline -> stock ${page.body.stock}`);
show('ben tries again', await buy(ben, '2 Returned Road, Springfield, IL 62701'));
console.log('stats ->', JSON.stringify(await stats()));
