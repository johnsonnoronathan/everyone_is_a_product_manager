// Oversell / double-order check, driven by the "oversell" section of plan.json.
//
//   k6 run -e PLAN=/abs/path/plan.json -e OUT_DIR=/abs/path/results k6/oversell.js
//
// N distinct buyers race for a small stock at the same moment, each double-clicking
// "buy". A correct system sells at most `stock` units and never charges a buyer twice,
// however hard it is hit. Being fast doesn't matter here; this checks correctness.
import http from 'k6/http';
import exec from 'k6/execution';
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
const SUCCESS = cfg.successStatuses || [200, 201];

const successes = new Counter('buy_success');
const doubleCharged = new Counter('buyers_with_multiple_successes');
const rejected = new Counter('buy_rejected');
const errors = new Counter('buy_errors');
const serverSold = new Gauge('server_sold');
const serverRemaining = new Gauge('server_remaining');
const serverCustomers = new Gauge('server_customers');
const serverInitial = new Gauge('server_initial');

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
  teardownTimeout: '60s',
  // Declared so the counters appear in the summary even when they stay at zero.
  thresholds: {
    buy_success: ['count>=0'],
    buyers_with_multiple_successes: ['count>=0'],
    buy_rejected: ['count>=0'],
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
  let ok = 0;
  for (const res of responses) {
    if (SUCCESS.includes(res.status)) ok++;
    else if (res.status === 0 || res.status >= 500) errors.add(1);
    else rejected.add(1);
  }
  successes.add(ok);
  if (ok > 1) doubleCharged.add(1);
}

export function teardown() {
  if (!cfg.stats) return;
  const [method, url, body, params] = buildRequest(BASE_URL, cfg.stats, { responseType: 'text', timeoutSeconds: 30 });
  const res = http.request(method, url, body, params);
  if (res.status !== 200) {
    console.warn(`Stats request failed: HTTP ${res.status}`);
    return;
  }
  const stats = res.json();
  const field = (key) => {
    const path = (cfg.stats.fields || {})[key];
    return path ? path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), stats) : undefined;
  };
  const record = (gauge, value) => value !== undefined && value !== null && gauge.add(Number(value));
  record(serverSold, field('sold'));
  record(serverRemaining, field('remaining'));
  record(serverCustomers, field('customers'));
  record(serverInitial, field('initial'));
}

const value = (data, name, stat = 'count') => (data.metrics[name] ? data.metrics[name].values[stat] : undefined);

export function handleSummary(data) {
  const r = {
    stock: STOCK,
    buyers: BUYERS,
    clicksPerBuyer: CLICKS,
    successfulPurchases: value(data, 'buy_success') || 0,
    buyersChargedTwice: value(data, 'buyers_with_multiple_successes') || 0,
    rejected: value(data, 'buy_rejected') || 0,
    errors: value(data, 'buy_errors') || 0,
    server: {
      sold: value(data, 'server_sold', 'value'),
      remaining: value(data, 'server_remaining', 'value'),
      customers: value(data, 'server_customers', 'value'),
      initial: value(data, 'server_initial', 'value'),
    },
  };
  const problems = [];
  const warnings = [];
  if (r.successfulPurchases > STOCK) problems.push(`Oversold: ${r.successfulPurchases} purchases confirmed for ${STOCK} units (${r.successfulPurchases - STOCK} customers were promised items that don't exist).`);
  if (r.buyersChargedTwice > 0) problems.push(`Double orders: ${r.buyersChargedTwice} buyers got two confirmed orders from one double-click.`);
  const s = r.server;
  if (s.sold !== undefined && s.sold > (s.initial ?? STOCK)) problems.push(`Database shows ${s.sold} orders for ${s.initial ?? STOCK} units.`);
  if (s.sold !== undefined && s.remaining !== undefined && s.sold + s.remaining !== (s.initial ?? STOCK)) {
    problems.push(`Inventory doesn't add up: ${s.sold} sold + ${s.remaining} remaining ≠ ${s.initial ?? STOCK} starting stock.`);
  }
  if (s.customers !== undefined && s.sold !== undefined && s.customers < s.sold) problems.push(`${s.sold - s.customers} orders belong to customers who already had one.`);
  if (BUYERS > STOCK && r.successfulPurchases < STOCK) {
    const released = s.sold !== undefined && s.remaining !== undefined && s.remaining > 0 && s.sold + s.remaining === (s.initial ?? STOCK);
    warnings.push(
      `Undersold: only ${r.successfulPurchases} of ${STOCK} units sold although ${BUYERS} buyers tried. ` +
        (released
          ? `The other ${s.remaining} units are back in stock (typically released after failed payments); real shoppers would retry and buy them.`
          : 'Check the errors below: stock may be stuck in orders that never completed.'),
    );
  }
  const totalRequests = BUYERS * CLICKS;
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
    `| Confirmed purchases (seen by buyers) | ${r.successfulPurchases} |`,
    `| Buyers charged twice | ${r.buyersChargedTwice} |`,
    `| Rejected (sold out / already ordered / rate limited) | ${r.rejected} |`,
    `| Server errors or timeouts | ${r.errors} |`,
    ...(s.sold !== undefined ? [`| Orders in database | ${s.sold} |`] : []),
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
