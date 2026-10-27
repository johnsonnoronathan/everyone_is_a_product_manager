// Oversell / double-order check, driven by the "oversell" section of plan.json.
//
//   k6 run -e PLAN=/abs/path/plan.json -e OUT_DIR=/abs/path/results k6/oversell.js
//
// N distinct buyers race for a small stock at the same moment, each double-clicking
// "buy". A correct system sells at most `stock` units and never charges a buyer twice,
// however hard it is hit. Being fast doesn't matter here; this checks correctness.
import http from 'k6/http';
import exec from 'k6/execution';
import { sleep } from 'k6';
import { Counter, Gauge } from 'k6/metrics';
import { buildRequest, loginPool, runSetupStep, pct } from './lib.js';

const plan = JSON.parse(open(__ENV.PLAN || './plan.json'));
if (!plan.oversell) throw new Error('plan.json has no "oversell" section; see references/capacity-interview.md');
const cfg = plan.oversell;
const BASE_URL = (__ENV.BASE_URL || plan.baseUrl).replace(/\/$/, '');
const OUT_DIR = (__ENV.OUT_DIR || '.').replace(/\/$/, '');
const BUYERS = Number(cfg.buyers || 1000);
const CLICKS = Number(cfg.clicksPerBuyer || 2);
const STOCK = Number(cfg.stock);
// 202 = order accepted while the payment is still being confirmed: it holds a unit, so it counts.
const SUCCESS = cfg.successStatuses || [200, 201, 202];
const PENDING = cfg.pendingStatuses || [202];
const SETTLE_SECONDS = Number(cfg.settleSeconds || 60);
// Where the order id sits in a successful response. Idempotent shops may answer a double-click
// with the same order twice; that is one purchase, not two.
const ORDER_ID_PATH = cfg.orderIdField || 'orderId';

const successes = new Counter('buy_success');
const doubleCharged = new Counter('buyers_with_multiple_successes');
const accepted = new Counter('buy_accepted_responses');
const rejected = new Counter('buy_rejected');
const pendingAtCheckout = new Counter('buy_pending');
const successWithoutId = new Counter('buy_success_without_order_id');
const errors = new Counter('buy_errors');
const serverSold = new Gauge('server_sold');
const serverRemaining = new Gauge('server_remaining');
const serverCustomers = new Gauge('server_customers');
const serverInitial = new Gauge('server_initial');
const serverPending = new Gauge('server_pending');

export const options = {
  scenarios: {
    rush: {
      executor: 'shared-iterations',
      exec: 'buy',
      vus: Math.min(BUYERS, Number(cfg.vus || 500)),
      iterations: BUYERS,
      maxDuration: '3m',
    },
  },
  setupTimeout: '300s',
  teardownTimeout: `${SETTLE_SECONDS + 60}s`,
  // Declared so the counters appear in the summary even when they stay at zero.
  thresholds: {
    buy_success: ['count>=0'],
    buyers_with_multiple_successes: ['count>=0'],
    buy_accepted_responses: ['count>=0'],
    buy_rejected: ['count>=0'],
    buy_pending: ['count>=0'],
    buy_success_without_order_id: ['count>=0'],
    buy_errors: ['count>=0'],
  },
};

export function setup() {
  runSetupStep(BASE_URL, cfg.setup);
  return { tokens: plan.auth && cfg.buy.auth ? loginPool(BASE_URL, plan.auth, BUYERS, 'buyer') : [] };
}

export function buy(data) {
  const i = exec.scenario.iterationInTest;
  const token = data.tokens.length ? data.tokens[i] : null;
  const step = { ...cfg.buy, okStatuses: [...(cfg.buy.okStatuses || []), 409, 410, 422, 429] };
  const request = buildRequest(BASE_URL, step, {
    vars: { user: `buyer${i}`, n: i },
    token,
    auth: plan.auth,
    timeoutSeconds: plan.requestTimeoutSeconds || 30,
  });
  const responses = http.batch(Array.from({ length: CLICKS }, () => request));
  const orderIds = new Set();
  let withoutId = 0;
  // Every response lands in exactly one bucket (accepted, rejected, error); handleSummary checks they add up.
  for (const res of responses) {
    if (SUCCESS.includes(res.status)) {
      accepted.add(1);
      if (PENDING.includes(res.status)) pendingAtCheckout.add(1);
      let id;
      try {
        id = ORDER_ID_PATH.split('.').reduce((o, k) => (o == null ? undefined : o[k]), res.json());
      } catch (_) {
        id = undefined;
      }
      if (id === undefined || id === null) withoutId++;
      else orderIds.add(String(id));
    } else if (res.status === 0 || res.status >= 500) errors.add(1);
    else rejected.add(1);
  }
  // Responses without an order id can't be told apart, so each counts as a purchase (conservative).
  const ok = orderIds.size + withoutId;
  if (withoutId) successWithoutId.add(withoutId);
  successes.add(ok);
  if (ok > 1) doubleCharged.add(1);
}

export function teardown() {
  if (!cfg.stats) return;
  const [method, url, body, params] = buildRequest(BASE_URL, cfg.stats, { responseType: 'text', timeoutSeconds: 30 });
  let stats;
  const field = (key) => {
    const path = (cfg.stats.fields || {})[key];
    return path ? path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), stats) : undefined;
  };
  // Orders whose payment is still being confirmed hold stock; give them time to settle.
  for (let waited = 0; ; waited += 2) {
    const res = http.request(method, url, body, params);
    if (res.status !== 200) {
      console.warn(`Stats request failed: HTTP ${res.status}`);
      return;
    }
    stats = res.json();
    if (!field('pending') || waited >= SETTLE_SECONDS) break;
    sleep(2);
  }
  const record = (gauge, value) => value !== undefined && value !== null && gauge.add(Number(value));
  record(serverSold, field('sold'));
  record(serverRemaining, field('remaining'));
  record(serverCustomers, field('customers'));
  record(serverInitial, field('initial'));
  record(serverPending, field('pending'));
}

const value = (data, name, stat = 'count') => (data.metrics[name] ? data.metrics[name].values[stat] : undefined);

export function handleSummary(data) {
  const r = {
    stock: STOCK,
    buyers: BUYERS,
    clicksPerBuyer: CLICKS,
    successfulPurchases: value(data, 'buy_success') || 0,
    buyersChargedTwice: value(data, 'buyers_with_multiple_successes') || 0,
    acceptedResponses: value(data, 'buy_accepted_responses') || 0,
    rejected: value(data, 'buy_rejected') || 0,
    pendingAtCheckout: value(data, 'buy_pending') || 0,
    successWithoutId: value(data, 'buy_success_without_order_id') || 0,
    errors: value(data, 'buy_errors') || 0,
    server: {
      sold: value(data, 'server_sold', 'value'),
      remaining: value(data, 'server_remaining', 'value'),
      customers: value(data, 'server_customers', 'value'),
      initial: value(data, 'server_initial', 'value'),
      pending: value(data, 'server_pending', 'value'),
    },
  };
  const problems = [];
  const warnings = [];
  if (r.successfulPurchases > STOCK) problems.push(`Oversold: ${r.successfulPurchases} purchases confirmed for ${STOCK} units (${r.successfulPurchases - STOCK} customers were promised items that don't exist).`);
  if (r.buyersChargedTwice > 0) problems.push(`Double orders: ${r.buyersChargedTwice} buyers got two confirmed orders from one double-click.`);
  const s = r.server;
  if (s.sold !== undefined && s.sold > (s.initial ?? STOCK)) problems.push(`Database shows ${s.sold} orders for ${s.initial ?? STOCK} units.`);
  const held = s.pending || 0;
  if (s.sold !== undefined && s.remaining !== undefined && s.sold + held + s.remaining !== (s.initial ?? STOCK)) {
    problems.push(`Inventory doesn't add up: ${s.sold} sold + ${held} awaiting payment + ${s.remaining} remaining ≠ ${s.initial ?? STOCK} starting stock.`);
  }
  if (held > 0) warnings.push(`${held} orders were still waiting for payment confirmation ${SETTLE_SECONDS} s after the rush. Check the reconciliation job.`);
  if (s.customers !== undefined && s.sold !== undefined && s.customers < s.sold) problems.push(`${s.sold - s.customers} orders belong to customers who already had one.`);
  if (BUYERS > STOCK && r.successfulPurchases < STOCK) {
    const released = s.sold !== undefined && s.remaining !== undefined && s.remaining > 0 && s.sold + held + s.remaining === (s.initial ?? STOCK);
    warnings.push(
      `Undersold: only ${r.successfulPurchases} of ${STOCK} units sold although ${BUYERS} buyers tried. ` +
        (released
          ? `The other ${s.remaining} units are back in stock (typically released after failed payments); real shoppers would retry and buy them.`
          : 'Check the errors below: stock may be stuck in orders that never completed.'),
    );
  }
  const totalRequests = BUYERS * CLICKS;
  // Software counts: every click must be accounted for exactly once, or the other numbers can't be trusted.
  const counted = r.acceptedResponses + r.rejected + r.errors;
  if (counted !== totalRequests) problems.push(`The counts don't add up: ${r.acceptedResponses} accepted + ${r.rejected} rejected + ${r.errors} errors = ${counted}, but ${totalRequests} clicks were sent. Fix the test before trusting its numbers.`);
  if (r.successWithoutId > 0) {
    warnings.push(`${r.successWithoutId} successful responses carried no order id at "${ORDER_ID_PATH}" (set oversell.orderIdField), so repeated answers for the same order could not be told apart. The database numbers below are the authoritative check.`);
  }
  if (r.errors > 0) warnings.push(`${r.errors} of ${totalRequests} requests (${pct(r.errors / totalRequests)}) failed with a server error or timeout.`);

  const pass = problems.length === 0;
  const lines = [
    '# Oversell check',
    '',
    `**${pass ? 'PASS' : 'FAIL'}:** ${BUYERS} buyers each clicked "buy" ${CLICKS}× at the same moment, competing for ${STOCK} units.`,
    '',
    ...problems.map((p) => `- ❌ ${p}`),
    ...warnings.map((w) => `- ⚠️ ${w}`),
    ...(pass && warnings.length === 0 ? ['- ✅ Never sold more than the stock, and nobody was charged twice.'] : []),
    '',
    '| Measure | Value |',
    '|---|---|',
    `| Units in stock | ${STOCK} |`,
    `| Clicks sent | ${totalRequests} |`,
    `| Accepted purchases (seen by buyers) | ${r.successfulPurchases} |`,
    ...(r.pendingAtCheckout ? [`| …of which "confirming payment" at checkout | ${r.pendingAtCheckout} |`] : []),
    `| Buyers charged twice | ${r.buyersChargedTwice} |`,
    `| Clicks rejected (sold out / already ordered / rate limited) | ${r.rejected} |`,
    `| Server errors or timeouts | ${r.errors} |`,
    ...(s.sold !== undefined ? [`| Orders in database | ${s.sold} |`] : []),
    ...(s.pending !== undefined ? [`| Orders still awaiting payment confirmation | ${s.pending} |`] : []),
    ...(s.remaining !== undefined ? [`| Stock counter in database | ${s.remaining} |`] : []),
    ...(s.customers !== undefined ? [`| Distinct customers with orders | ${s.customers} |`] : []),
  ];
  const markdown = lines.join('\n') + '\n';
  return {
    stdout: markdown,
    [`${OUT_DIR}/oversell-summary.md`]: markdown,
    [`${OUT_DIR}/oversell-summary.json`]: JSON.stringify({ pass, problems, warnings, ...r }, null, 2),
  };
}
