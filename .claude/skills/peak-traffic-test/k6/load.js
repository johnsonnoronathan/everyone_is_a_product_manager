// Staged load test driven by plan.json (made by scripts/capacity.mjs).
//
//   k6 run -e PLAN=/abs/path/plan.json -e OUT_DIR=/abs/path/results k6/load.js
//   k6 run -e SMOKE=1 -e PLAN=... k6/load.js   # 10 s at 2 req/s per endpoint: checks the requests work
//
// Each stage sends a fixed arrival rate per endpoint (open model: new requests keep
// arriving even when the site slows down, like real shoppers). Every stage is judged
// separately, so the summary shows the highest load the site handled and where it broke.
import http from 'k6/http';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
import { buildRequest, loginPool, runSetupStep, fmtMs, pct } from './lib.js';

const plan = JSON.parse(open(__ENV.PLAN || './plan.json'));
const BASE_URL = (__ENV.BASE_URL || plan.baseUrl).replace(/\/$/, '');
const OUT_DIR = (__ENV.OUT_DIR || '.').replace(/\/$/, '');
const SMOKE = Boolean(__ENV.SMOKE);
const POOL_SIZE = plan.auth ? (SMOKE ? 20 : Number(plan.auth.poolSize || 500)) : 0;
const STATUS_CLASSES = ['2xx', '3xx', '4xx', '5xx', 'timeout'];

const serverErrors = new Counter('server_errors');
const timeouts = new Counter('timeouts');
const responses = new Counter('responses');

// Up to 1% of a step's planned requests may go unsent. Uses requests/second (ep.stageRates[].rps),
// not the k6 `rate`, which is per minute for low-traffic endpoints.
const allowedDrops = (ep, si) => Math.ceil(ep.stageRates[si].rps * plan.stageSeconds * 0.01);

const scenarios = {};
const thresholds = {};
const byScenario = {};
let startAt = 0;

if (SMOKE) {
  for (const ep of plan.endpoints) {
    const name = `smoke_${ep.id}`;
    scenarios[name] = {
      executor: 'constant-arrival-rate',
      exec: 'hit',
      rate: 2,
      timeUnit: '1s',
      duration: '10s',
      preAllocatedVUs: 5,
      maxVUs: 20,
      tags: { stage: 'smoke', endpoint: ep.id },
    };
    byScenario[name] = { ep, offset: 0 };
    for (const cls of STATUS_CLASSES) thresholds[`responses{endpoint:${ep.id},class:${cls}}`] = ['count>=0'];
    thresholds[`http_req_failed{endpoint:${ep.id}}`] = ['rate>=0'];
  }
}

(SMOKE ? [] : plan.stages).forEach((multiplier, si) => {
  const stage = `s${si + 1}`;
  plan.endpoints.forEach((ep, ei) => {
    const name = `${stage}_${ep.id}`;
    const { rate, timeUnit } = ep.stageRates[si];
    scenarios[name] = {
      executor: 'constant-arrival-rate',
      exec: 'hit',
      rate,
      timeUnit,
      duration: `${plan.stageSeconds}s`,
      startTime: `${startAt}s`,
      preAllocatedVUs: ep.vus[si].preAllocated,
      maxVUs: ep.vus[si].max,
      gracefulStop: `${plan.requestTimeoutSeconds}s`,
      tags: { stage, endpoint: ep.id },
    };
    byScenario[name] = { ep, offset: (si * plan.endpoints.length + ei) * 7919 };
    const filter = `{stage:${stage},endpoint:${ep.id}}`;
    thresholds[`http_req_duration${filter}`] = [`p(95)<${ep.p95Ms}`];
    thresholds[`http_req_failed${filter}`] = [`rate<${plan.maxErrorRate}`];
    thresholds[`http_reqs${filter}`] = ['count>=0'];
    thresholds[`server_errors${filter}`] = ['count>=0'];
    thresholds[`timeouts${filter}`] = ['count>=0'];
    // Iterations k6 could not start because every virtual user was still waiting on a slow response.
    thresholds[`dropped_iterations{scenario:${name}}`] = [`count<=${allowedDrops(ep, si)}`];
  });
  startAt += plan.stageSeconds + plan.cooldownSeconds;
});

export const options = {
  scenarios,
  thresholds,
  setupTimeout: '180s',
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  discardResponseBodies: !SMOKE,
  noConnectionReuse: false,
};

export function setup() {
  runSetupStep(BASE_URL, plan.setup);
  return { tokens: plan.auth ? loginPool(BASE_URL, plan.auth, POOL_SIZE) : [] };
}

export function hit(data) {
  const { ep, offset } = byScenario[exec.scenario.name];
  const n = exec.scenario.iterationInTest + offset;
  const token = ep.auth ? data.tokens[n % data.tokens.length] : null;
  const tags = { stage: exec.scenario.name.split('_')[0], endpoint: ep.id };
  const [method, url, body, params] = buildRequest(BASE_URL, ep, {
    vars: { user: `lt${n % (POOL_SIZE || 1e9)}`, n },
    token,
    auth: plan.auth,
    timeoutSeconds: plan.requestTimeoutSeconds,
    tags,
  });
  const res = http.request(method, url, body, params);
  if (res.status === 0) timeouts.add(1, tags);
  else if (res.status >= 500) serverErrors.add(1, tags);
  if (SMOKE) {
    const cls = res.status === 0 ? 'timeout' : `${Math.floor(res.status / 100)}xx`;
    responses.add(1, { endpoint: ep.id, class: cls });
    const expected = (res.status >= 200 && res.status < 400) || (ep.okStatuses || []).includes(res.status);
    if (!expected && warned++ < 3) console.warn(`[smoke] ${ep.name}: HTTP ${res.status} ${method} ${url} -> ${String(res.body).slice(0, 200)}`);
  }
}
let warned = 0;

function smokeSummary(data) {
  const rows = plan.endpoints.map((ep) => {
    const counts = Object.fromEntries(STATUS_CLASSES.map((c) => [c, metric(data, 'responses', `{endpoint:${ep.id},class:${c}}`, 'count') || 0]));
    const failRate = metric(data, 'http_req_failed', `{endpoint:${ep.id}}`, 'rate');
    return { ep, counts, failRate, ok: failRate === 0 && Object.values(counts).some((n) => n > 0) };
  });
  const allOk = rows.every((r) => r.ok);
  const lines = [
    `# Smoke test: ${allOk ? 'requests look sane' : 'FIX BEFORE LOAD TESTING'}`,
    '',
    '| Request | 2xx | 3xx | 4xx | 5xx | Timeout | Unexpected |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.ep.name} | ${STATUS_CLASSES.map((c) => r.counts[c]).join(' | ')} | ${pct(r.failRate)} |`),
    '',
    allOk
      ? 'Every request type returned expected status codes. Check that 3xx responses are not redirects to a login page, then run the full test.'
      : 'Some requests returned unexpected status codes (see the warnings above). Common causes: wrong path or body, missing auth, CSRF protection, or a rate limiter blocking the load generator. A load test with broken requests measures nothing.',
  ];
  return { stdout: lines.join('\n') + '\n' };
}

function metric(data, name, filter, stat) {
  const m = data.metrics[`${name}${filter}`];
  return m ? m.values[stat] : undefined;
}

export function handleSummary(data) {
  if (SMOKE) return smokeSummary(data);
  const stages = plan.stages.map((multiplier, si) => {
    const stage = `s${si + 1}`;
    const endpoints = plan.endpoints.map((ep) => {
      const filter = `{stage:${stage},endpoint:${ep.id}}`;
      const requests = metric(data, 'http_reqs', filter, 'count') || 0;
      const dropped = metric(data, 'dropped_iterations', `{scenario:${stage}_${ep.id}}`, 'count') || 0;
      const p95 = metric(data, 'http_req_duration', filter, 'p(95)');
      const errorRate = metric(data, 'http_req_failed', filter, 'rate');
      const reasons = [];
      if (requests === 0) reasons.push('no requests completed');
      if (p95 !== undefined && p95 >= ep.p95Ms) reasons.push(`too slow (p95 ${fmtMs(p95)} > ${fmtMs(ep.p95Ms)})`);
      if (errorRate !== undefined && errorRate >= plan.maxErrorRate) reasons.push(`${pct(errorRate)} errors`);
      if (dropped > allowedDrops(ep, si)) reasons.push(`${dropped} requests never sent (all virtual users stuck waiting)`);
      return {
        endpoint: ep.id,
        name: ep.name,
        targetRps: ep.stageRates[si].rps,
        achievedRps: Math.round((requests / plan.stageSeconds) * 10) / 10,
        requests,
        p50: metric(data, 'http_req_duration', filter, 'med'),
        p95,
        p99: metric(data, 'http_req_duration', filter, 'p(99)'),
        budgetMs: ep.p95Ms,
        errorRate,
        serverErrors: metric(data, 'server_errors', filter, 'count') || 0,
        timeouts: metric(data, 'timeouts', filter, 'count') || 0,
        dropped,
        pass: reasons.length === 0,
        reasons,
      };
    });
    return {
      stage,
      multiplier,
      totalTargetRps: Math.round(endpoints.reduce((s, e) => s + e.targetRps, 0) * 10) / 10,
      pass: endpoints.every((e) => e.pass),
      endpoints,
    };
  });

  const passed = stages.filter((s) => s.pass);
  const firstFail = stages.find((s) => !s.pass);
  const highestPassBeforeFail = firstFail ? stages.slice(0, stages.indexOf(firstFail)).pop() : stages[stages.length - 1];
  // Meets target = every step up to and including the first step at or above 100% passed.
  const targetStage = stages.find((s) => s.multiplier >= 1);
  const meetsTarget = Boolean(targetStage) && stages.filter((s) => s.multiplier <= targetStage.multiplier).every((s) => s.pass);
  const verdict = {
    meetsTarget,
    holdsUpTo: highestPassBeforeFail ? { multiplier: highestPassBeforeFail.multiplier, rps: highestPassBeforeFail.totalTargetRps } : null,
    breaksAt: firstFail
      ? {
          multiplier: firstFail.multiplier,
          rps: firstFail.totalTargetRps,
          reasons: firstFail.endpoints.filter((e) => !e.pass).map((e) => `${e.name}: ${e.reasons.join('; ')}`),
        }
      : null,
    stagesPassed: passed.length,
    stagesTotal: stages.length,
  };

  const headline = meetsTarget
    ? `PASS: handled the target load (${plan.totalTargetRps} req/s).`
    : `FAIL: did not handle the target load (${plan.totalTargetRps} req/s).`;
  const lines = [
    `# Load test: ${plan.event}`,
    '',
    `**${headline}**`,
    '',
    verdict.holdsUpTo
      ? `- Holds up to **${verdict.holdsUpTo.multiplier * 100}% of target** (${verdict.holdsUpTo.rps} req/s) with every request type inside its speed budget.`
      : '- Did not pass even the first (lowest) step.',
    verdict.breaksAt
      ? `- Breaks at **${verdict.breaksAt.multiplier * 100}% of target** (${verdict.breaksAt.rps} req/s): ${verdict.breaksAt.reasons.join(' / ')}`
      : '- Did not break within the tested range. Headroom above the highest step is unknown.',
    '',
    `Target: ${plan.visitors} visitors in ${plan.windowSeconds} s with ${plan.peakFactor}× peaks = ${plan.totalTargetRps} req/s. Each step ran ${plan.stageSeconds} s against ${BASE_URL}.`,
    '',
    '| Step | Request | Target req/s | Achieved req/s | Median | p95 (budget) | p99 | Errors | 5xx | Timeouts | Not sent | Result |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const s of stages) {
    for (const e of s.endpoints) {
      lines.push(
        `| ${s.multiplier * 100}% | ${e.name} | ${e.targetRps} | ${e.achievedRps} | ${fmtMs(e.p50)} | ${fmtMs(e.p95)} (${fmtMs(e.budgetMs)}) | ${fmtMs(e.p99)} | ${pct(e.errorRate)} | ${e.serverErrors} | ${e.timeouts} | ${e.dropped} | ${e.pass ? 'PASS' : 'FAIL: ' + e.reasons.join('; ')} |`,
      );
    }
  }
  lines.push(
    '',
    'How to read this: *p95* = 95% of requests were faster than this. *Errors* = share of requests that failed (5xx, timeouts, or unexpected status codes). *Not sent* = requests k6 could not start because every simulated shopper was stuck waiting, which is a sign the site had stopped keeping up.',
  );
  const markdown = lines.join('\n') + '\n';
  return {
    stdout: markdown,
    [`${OUT_DIR}/load-summary.md`]: markdown,
    [`${OUT_DIR}/load-summary.json`]: JSON.stringify({ plan: { event: plan.event, baseUrl: BASE_URL, totalTargetRps: plan.totalTargetRps }, verdict, stages }, null, 2),
  };
}
