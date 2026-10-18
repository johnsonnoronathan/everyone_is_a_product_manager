import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.resolve('.claude/skills/acceptance-test/scripts/ac-report.mjs');
const run = (status) => ({ results: [{ status, attachments: [], error: status === 'passed' ? undefined : { message: '\u001b[31mExpected: 1\u001b[39m\nReceived: 2' } }] });
const spec = (title, tags, statuses) => ({ title, tags, file: 'a.spec.mjs', line: 1, tests: statuses.map((s) => ({ projectName: 'chrome', ...run(s) })) });

function report(criteria, specs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-report-'));
  fs.writeFileSync(path.join(dir, 'criteria.md'), criteria);
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ config: { version: '1.56.1' }, stats: {}, suites: [{ title: 'a.spec.mjs', specs }] }));
  const out = spawnSync(process.execPath, [script, path.join(dir, 'results.json'), path.join(dir, 'criteria.md'), path.join(dir, 'ACCEPTANCE.md')], { encoding: 'utf8' });
  return { code: out.status, text: fs.readFileSync(path.join(dir, 'ACCEPTANCE.md'), 'utf8') };
}

const criteria = `
### AC-01 · Must · Always passes
- **Then** fine
### AC-02 · Must · Sometimes passes
- **Then** flaky
### AC-03 · Should · Never passes
- **Then** broken
### AC-04 · Could · Nobody wrote a test
- **Then** missing
### AC-05 · Must · Proven by a load test
- **Evidence:** external: k6 oversell check
`;

test('classifies pass, flaky, fail, not covered and external', () => {
  const { code, text } = report(criteria, [
    spec('AC-01 ok', ['AC-01'], ['passed']), spec('AC-01 ok', ['AC-01'], ['passed']),
    spec('AC-02 sometimes', ['AC-02'], ['passed']), spec('AC-02 sometimes', ['AC-02'], ['failed']),
    spec('AC-03 broken', ['AC-03'], ['failed']), spec('AC-03 broken', ['AC-03'], ['timedOut']),
    spec('stray test', [], ['passed']),
  ]);
  assert.match(text, /\| AC-01 \| Must \| Always passes \| 2\/2 \| ✅ PASS/);
  assert.match(text, /\| AC-02 \| Must \| Sometimes passes \| 1\/2 \| ⚠️ FLAKY/);
  assert.match(text, /\| AC-03 \| Should \| Never passes \| 0\/2 \| ❌ FAIL/);
  assert.match(text, /\| AC-04 \| Could \| Nobody wrote a test \| — \| ⬜ NOT COVERED/);
  assert.match(text, /\| AC-05 \| Must \| Proven by a load test \| — \| 🔗 EXTERNAL \| k6 oversell check/);
  assert.match(text, /\*\*Not ready:\*\* 1 "Must" criteria are not passing: AC-02 \(FLAKY\)/);
  assert.match(text, /Tests not linked to an agreed criterion[\s\S]*stray test/);
  assert.match(text, /Expected: 1 Received: 2/, 'ANSI colours stripped from errors');
  assert.equal(code, 1, 'non-zero exit when a Must criterion is not passing');
});

test('a test that only passed on retry is not a pass', () => {
  const retried = { title: 'AC-01 retried', tags: ['AC-01'], tests: [{ projectName: 'chrome', results: [{ status: 'failed', attachments: [] }, { status: 'passed', attachments: [] }] }] };
  const { text } = report('### AC-01 · Must · Retried\n- x\n', [retried]);
  assert.match(text, /\| AC-01 \| Must \| Retried \| 0\/1 \| ❌ FAIL/);
});

test('ready for sign-off only when every Must passes', () => {
  const { code, text } = report('### AC-01 · Must · A\n- x\n### AC-02 · Should · B\n- y\n', [spec('AC-01', ['AC-01'], ['passed']), spec('AC-02', ['AC-02'], ['failed'])]);
  assert.match(text, /\*\*Ready for sign-off:\*\* all 1 "Must" criteria pass\. 1 "Should\/Could" criteria are open\./);
  assert.equal(code, 0);
});
