import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, renderPlan } from '../.claude/skills/peak-traffic-test/scripts/capacity.mjs';

const brief = {
  baseUrl: 'https://staging.example.com/',
  visitors: 20000,
  windowSeconds: 120,
  peakFactor: 3,
  journey: [
    { name: 'Product page', method: 'get', path: '/p/42', perVisitor: 4, p95Ms: 600 },
    { name: 'Checkout', method: 'POST', path: '/checkout', perVisitor: 0.6, p95Ms: 2500 },
    { name: 'Admin report', method: 'GET', path: '/admin', perVisitor: 0.001 },
  ],
};

test('matches the worked example in capacity-interview.md', () => {
  const plan = buildPlan(brief);
  const [product, checkout] = plan.endpoints;
  assert.equal(product.averageRps, 666.67);
  assert.equal(product.targetRps, 2000);
  assert.equal(checkout.targetRps, 300);
  assert.equal(plan.baseUrl, 'https://staging.example.com');
  assert.equal(product.method, 'GET');
  assert.deepEqual(plan.stages, [0.5, 1, 1.5, 2]);
  assert.deepEqual(product.stageRates.map((s) => s.rate), [1000, 2000, 3000, 4000]);
});

test('uses per-minute arrival rates for low traffic', () => {
  const admin = buildPlan(brief).endpoints[2];
  // 20000 * 0.001 / 120 * 3 = 0.5 req/s → 30 per minute at 100%
  assert.deepEqual(admin.stageRates[1], { rate: 30, timeUnit: '1m', rps: 0.5 });
});

test('caps virtual users and keeps preallocation below max', () => {
  const plan = buildPlan({ ...brief, maxVUsPerScenario: 100 });
  for (const e of plan.endpoints) for (const v of e.vus) assert.ok(v.preAllocated <= v.max && v.max <= 100);
});

test('rejects incomplete briefs with a readable message', () => {
  assert.throws(() => buildPlan({ visitors: 10 }), /missing "baseUrl".*missing "windowSeconds"/);
  assert.throws(() => buildPlan({ ...brief, journey: [{ name: 'x' }] }), /needs "method" and "path"/);
});

test('renders a plan table a PM can approve', () => {
  const text = renderPlan(buildPlan(brief));
  assert.match(text, /20,000 visitors in 120 s/);
  assert.match(text, /\| Checkout \(`POST \/checkout`\) \| 0.6 \| 100 \| \*\*300\*\* \| 2500 ms \|/);
});
