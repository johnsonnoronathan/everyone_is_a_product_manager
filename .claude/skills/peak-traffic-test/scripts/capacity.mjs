#!/usr/bin/env node
// Turns a traffic brief (business numbers) into a load-test plan that k6/load.js and
// k6/oversell.js read, and prints the plan as a table a non-engineer can approve.
//
//   node capacity.mjs <brief.json> [plan.json]
//
// See ../references/capacity-interview.md for the brief format.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULTS = {
  peakFactor: 3,
  stages: [0.5, 1, 1.5, 2],
  stageSeconds: 30,
  cooldownSeconds: 5,
  maxErrorRate: 0.01,
  requestTimeoutSeconds: 10,
  maxVUsPerScenario: 1500,
};

export function buildPlan(brief) {
  const b = { ...DEFAULTS, ...brief };
  const problems = [];
  for (const field of ['baseUrl', 'visitors', 'windowSeconds', 'journey']) {
    if (b[field] === undefined) problems.push(`missing "${field}"`);
  }
  if (!Array.isArray(b.journey) || b.journey.length === 0) problems.push('"journey" must list at least one request');
  if (problems.length) throw new Error(`Invalid brief: ${problems.join(', ')}`);

  const endpoints = b.journey.map((step, i) => {
    if (!step.method || !step.path) throw new Error(`journey[${i}] needs "method" and "path"`);
    const id = (step.id ?? step.name ?? `step${i + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const perVisitor = step.perVisitor ?? 1;
    const averageRps = (b.visitors * perVisitor) / b.windowSeconds;
    const targetRps = averageRps * b.peakFactor;
    const p95Ms = step.p95Ms ?? 1000;
    return {
      id,
      name: step.name ?? id,
      method: step.method.toUpperCase(),
      path: step.path,
      headers: step.headers ?? {},
      body: step.body ?? null,
      auth: Boolean(step.auth),
      okStatuses: step.okStatuses ?? [],
      p95Ms,
      perVisitor,
      averageRps: round(averageRps),
      targetRps: round(targetRps),
      stageRates: b.stages.map((multiplier) => arrivalRate(targetRps * multiplier)),
      // Enough virtual users to sustain the rate while latency is within 4x budget. Beyond
      // that k6 reports dropped iterations, which load.js counts as failures: the system
      // is already far too slow at that point.
      vus: b.stages.map((multiplier) => {
        const needed = Math.ceil(targetRps * multiplier * (p95Ms / 1000) * 4) + 10;
        return { preAllocated: Math.min(Math.ceil(needed / 2), b.maxVUsPerScenario), max: Math.min(needed, b.maxVUsPerScenario) };
      }),
    };
  });

  return {
    event: b.event ?? 'Peak traffic event',
    baseUrl: b.baseUrl.replace(/\/$/, ''),
    visitors: b.visitors,
    windowSeconds: b.windowSeconds,
    peakFactor: b.peakFactor,
    stages: b.stages,
    stageSeconds: b.stageSeconds,
    cooldownSeconds: b.cooldownSeconds,
    maxErrorRate: b.maxErrorRate,
    requestTimeoutSeconds: b.requestTimeoutSeconds,
    totalTargetRps: round(endpoints.reduce((sum, e) => sum + e.targetRps, 0)),
    endpoints,
    auth: b.auth ?? null,
    setup: b.setup ?? null,
    oversell: b.oversell ?? null,
    estimatedDurationSeconds: b.stages.length * (b.stageSeconds + b.cooldownSeconds),
  };
}

// k6 arrival rates must be integers; use per-minute units for low rates to keep precision.
function arrivalRate(rps) {
  if (rps >= 10) return { rate: Math.round(rps), timeUnit: '1s', rps: Math.round(rps) };
  const perMinute = Math.max(1, Math.round(rps * 60));
  return { rate: perMinute, timeUnit: '1m', rps: round(perMinute / 60) };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

export function renderPlan(plan) {
  const lines = [
    `## Load-test plan: ${plan.event}`,
    '',
    `- Expected: **${plan.visitors.toLocaleString('en-US')} visitors in ${plan.windowSeconds} s**, peaks ${plan.peakFactor}× the average`,
    `- Target: **${plan.totalTargetRps.toLocaleString('en-US')} requests/second** across the journey below`,
    `- Test steps: ${plan.stages.map((s) => `${s * 100}%`).join(' → ')} of target, ${plan.stageSeconds} s each (about ${Math.ceil(plan.estimatedDurationSeconds / 60)} min total)`,
    `- Pass rule per step: every request type meets its speed budget (95% of requests faster than the budget) and fewer than ${plan.maxErrorRate * 100}% errors`,
    `- Against: ${plan.baseUrl}`,
    '',
    '| Request | Per visitor | Average req/s | Target req/s (peak) | Speed budget (p95) |',
    '|---|---|---|---|---|',
    ...plan.endpoints.map(
      (e) => `| ${e.name} (\`${e.method} ${e.path}\`) | ${e.perVisitor} | ${e.averageRps} | **${e.targetRps}** | ${e.p95Ms} ms |`,
    ),
  ];
  if (plan.oversell) {
    lines.push(
      '',
      `Oversell check: ${plan.oversell.buyers} buyers × ${plan.oversell.clicksPerBuyer ?? 2} clicks each race for ${plan.oversell.stock} units. Pass = no more than ${plan.oversell.stock} sales and no customer charged twice.`,
    );
  }
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [briefPath, planPath = 'plan.json'] = process.argv.slice(2);
  if (!briefPath) {
    console.error('Usage: node capacity.mjs <brief.json> [plan.json]');
    process.exit(1);
  }
  const plan = buildPlan(JSON.parse(fs.readFileSync(briefPath, 'utf8')));
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
  console.log(renderPlan(plan));
  console.log(`\nPlan written to ${planPath}`);
}
