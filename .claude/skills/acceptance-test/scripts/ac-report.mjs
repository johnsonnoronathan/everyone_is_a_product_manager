#!/usr/bin/env node
// Builds the acceptance traceability matrix: criterion → tests → results → evidence.
//
//   node ac-report.mjs <playwright-results.json> <criteria.md> [ACCEPTANCE.md]
//
// Status per criterion:
//   PASS         every run of every linked test passed
//   FAIL         every run failed
//   FLAKY        some runs passed and some failed. Never counted as a pass: either the
//                test is unreliable or the product behaves inconsistently; both need a look
//   NOT COVERED  no test is linked to the criterion
//   EXTERNAL     verified by other evidence named in the criterion (e.g. a load test)
//   SKIPPED      linked tests were skipped
import fs from 'node:fs';
import path from 'node:path';

const [resultsPath, criteriaPath, outPath] = process.argv.slice(2);
if (!resultsPath || !criteriaPath) {
  console.error('Usage: node ac-report.mjs <playwright-results.json> <criteria.md> [ACCEPTANCE.md]');
  process.exit(1);
}

const stripAnsi = (s) => String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '');
const AC_ID = /\bAC-\d+\b/g;

// --- Criteria ---------------------------------------------------------------------
function parseCriteria(markdown) {
  const criteria = [];
  let current = null;
  for (const line of markdown.split('\n')) {
    const heading = line.match(/^#{2,4}\s+(AC-\d+)\s*[·|-]\s*(Must|Should|Could)\s*[·|-]\s*(.+?)\s*$/i);
    if (heading) {
      current = { id: heading[1], priority: heading[2][0].toUpperCase() + heading[2].slice(1).toLowerCase(), title: heading[3], lines: [], external: null };
      criteria.push(current);
      continue;
    }
    if (/^#{1,4}\s/.test(line)) current = null;
    if (!current || !line.trim()) continue;
    current.lines.push(line.trim());
    const evidence = line.match(/\*\*Evidence:\*\*\s*external[:\s-]*(.*)$/i);
    if (evidence) current.external = evidence[1].trim() || 'external evidence';
  }
  return criteria;
}

// --- Playwright results -------------------------------------------------------------
function collectRuns(report) {
  const runs = [];
  const visit = (suite, titles) => {
    for (const spec of suite.specs ?? []) {
      // Demo journeys (prepare-review) take screenshots for the review page; they don't test a criterion.
      if ((spec.tags ?? []).some((t) => t.replace(/^@/, '') === 'journey')) continue;
      const ids = new Set([...(spec.tags ?? []).map((t) => t.replace(/^@/, '')).filter((t) => /^AC-\d+$/.test(t)), ...(spec.title.match(AC_ID) ?? [])]);
      for (const test of spec.tests ?? []) {
        const last = test.results?.[test.results.length - 1];
        if (!last) continue;
        runs.push({
          ids: [...ids],
          title: [...titles, spec.title].filter(Boolean).join(' › '),
          project: test.projectName,
          status: last.status, // passed | failed | timedOut | skipped | interrupted
          retries: test.results.length - 1,
          error: stripAnsi(last.error?.message ?? last.errors?.[0]?.message ?? ''),
          attachments: (last.attachments ?? []).filter((a) => a.path),
          file: spec.file,
          line: spec.line,
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child, [...titles, child.title === suite.title ? '' : child.title]);
  };
  for (const suite of report.suites ?? []) visit(suite, []);
  return runs;
}

const report = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
const criteria = parseCriteria(fs.readFileSync(criteriaPath, 'utf8'));
const runs = collectRuns(report);
const outDir = path.dirname(path.resolve(outPath ?? 'ACCEPTANCE.md'));
const rel = (p) => path.relative(outDir, p).split(path.sep).join('/');
const shortError = (msg) =>
  msg
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^at /.test(l) && !/^Call log:/.test(l))
    .slice(0, 4)
    .join(' ')
    .replace(/\|/g, '\\|')
    .slice(0, 300);

const rows = criteria.map((c) => {
  const linked = runs.filter((r) => r.ids.includes(c.id));
  const ran = linked.filter((r) => r.status !== 'skipped');
  const passed = ran.filter((r) => r.status === 'passed' && r.retries === 0).length;
  let status;
  if (linked.length === 0) status = c.external ? 'EXTERNAL' : 'NOT COVERED';
  else if (ran.length === 0) status = 'SKIPPED';
  else if (passed === ran.length) status = 'PASS';
  else if (passed === 0) status = 'FAIL';
  else status = 'FLAKY';
  const failures = ran.filter((r) => r.status !== 'passed' || r.retries > 0);
  const evidenceRun = failures[0] ?? ran[0];
  const screenshot = evidenceRun?.attachments.find((a) => a.contentType?.startsWith('image/'));
  const trace = evidenceRun?.attachments.find((a) => a.name === 'trace');
  const data = evidenceRun?.attachments.find((a) => a.name === 'evidence');
  return {
    ...c,
    status,
    runs: ran.length,
    passed,
    tests: [...new Set(linked.map((r) => r.title))],
    errors: [...new Set(failures.map((r) => shortError(r.error)).filter(Boolean))],
    evidence: [screenshot && `[screenshot](${rel(screenshot.path)})`, data && `[evidence](${rel(data.path)})`, trace && `[trace](${rel(trace.path)})`].filter(Boolean).join(' · ') || (c.external ? c.external : '—'),
  };
});

const unmapped = [...new Set(runs.filter((r) => r.ids.length === 0 || r.ids.every((id) => !criteria.some((c) => c.id === id))).map((r) => r.title))];
const count = (s) => rows.filter((r) => r.status === s).length;
const mustBlocking = rows.filter((r) => r.priority === 'Must' && !['PASS', 'EXTERNAL'].includes(r.status));
const shouldOpen = rows.filter((r) => r.priority !== 'Must' && !['PASS', 'EXTERNAL'].includes(r.status));
const external = rows.filter((r) => r.status === 'EXTERNAL');
const icon = { PASS: '✅ PASS', FAIL: '❌ FAIL', FLAKY: '⚠️ FLAKY', 'NOT COVERED': '⬜ NOT COVERED', EXTERNAL: '🔗 EXTERNAL', SKIPPED: '⏭️ SKIPPED' };

const stats = report.stats ?? {};
const lines = [
  '# Acceptance test report',
  '',
  mustBlocking.length === 0
    ? `**Ready for sign-off:** all ${rows.filter((r) => r.priority === 'Must').length} "Must" criteria pass${external.length ? ` (${external.length} verified by external evidence, check the linked results)` : ''}.${shouldOpen.length ? ` ${shouldOpen.length} "Should/Could" criteria are open.` : ''}`
    : `**Not ready:** ${mustBlocking.length} "Must" criteria are not passing: ${mustBlocking.map((r) => `${r.id} (${r.status})`).join(', ')}.`,
  '',
  `- Run: ${stats.startTime ? new Date(stats.startTime).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'unknown time'} · Playwright ${report.config?.version ?? '?'} · ${runs.length} test runs (each test repeated to detect flakiness, no retries)`,
  `- Criteria: \`${criteriaPath}\` (${criteria.length}) · Results: ${count('PASS')} pass, ${count('FAIL')} fail, ${count('FLAKY')} flaky, ${count('NOT COVERED')} not covered, ${count('EXTERNAL')} external, ${count('SKIPPED')} skipped`,
  '',
  '| ID | Priority | Criterion | Runs passed | Status | Evidence |',
  '|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.id} | ${r.priority} | ${r.title} | ${r.runs ? `${r.passed}/${r.runs}` : '—'} | ${icon[r.status]} | ${r.evidence} |`),
];

const problems = rows.filter((r) => !['PASS', 'EXTERNAL'].includes(r.status));
if (problems.length) {
  lines.push('', '## What needs attention');
  for (const r of problems) {
    lines.push('', `### ${r.id} · ${r.priority} · ${icon[r.status]}: ${r.title}`, '', ...r.lines.map((l) => (l.startsWith('-') ? l : `> ${l}`)));
    if (r.status === 'NOT COVERED') lines.push('', 'No automated test is linked to this criterion. Add one, or record how it was verified manually.');
    if (r.status === 'FLAKY') lines.push('', `Passed ${r.passed} of ${r.runs} runs. Find out whether the test is unreliable or the product behaves inconsistently (race conditions are real bugs). Do not sign off on a flaky result.`);
    if (r.errors.length) lines.push('', 'What the test saw:', ...r.errors.map((e) => `- \`${e.replace(/`/g, "'")}\``));
    if (r.tests.length) lines.push('', `Tests: ${r.tests.map((t) => `\`${t}\``).join(', ')}`);
  }
}
if (external.length) {
  lines.push('', '## Verified outside this test run', '', ...external.map((r) => `- **${r.id}** ${r.title}: ${r.external}. Attach or link the result before sign-off.`));
}
if (unmapped.length) {
  lines.push('', '## Tests not linked to an agreed criterion', '', 'These ran but trace to no criterion in the agreed list. Either add the criterion (with the product owner) or remove the test.', ...unmapped.map((t) => `- \`${t}\``));
}
lines.push(
  '',
  '## Sign-off',
  '',
  '| Criterion | Decision (Accept / Reject / Accept with note) | Note |',
  '|---|---|---|',
  ...rows.map((r) => `| ${r.id} ${r.title} | | |`),
  '',
  'Product owner: ____________________ Date: __________ Build/commit: __________',
);

const markdown = lines.join('\n') + '\n';
if (outPath) fs.writeFileSync(outPath, markdown);
console.log(markdown);
process.exitCode = mustBlocking.length ? 1 : 0;
