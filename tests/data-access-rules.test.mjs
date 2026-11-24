import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('finds open Supabase tables, permissive policies and open Firebase rules', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rls-')), 'r.json');
  const res = spawnSync(process.execPath, ['.claude/skills/launch-review/scripts/check-data-access-rules.mjs', 'tests/fixtures/data-access', out], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  const { findings, tables } = JSON.parse(fs.readFileSync(out, 'utf8'));
  const summary = findings.map((f) => `${f.severity} ${f.table ?? f.file}`).sort();
  assert.ok(findings.every((f) => f.rule), 'every finding names its rule, so the review gate can count it');
  assert.deepEqual(summary, [
    'Critical firestore.rules',
    'Critical public.audit_log',
    'Critical public.orders',
    'Critical public.profiles',
    'Review firestore.rules',
    'Review public.products',
  ]);
  assert.ok(tables.includes('private.secrets'));
  assert.ok(!findings.some((f) => f.table === 'private.secrets'), 'non-public schemas are not exposed by default');
});

test('runs from a folder whose path has a space (and on Windows)', () => {
  // URL.pathname keeps %20 and adds a leading slash before the drive letter; the script must still run.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rls space-'));
  const script = path.join(dir, 'check-data-access-rules.mjs');
  fs.copyFileSync('.claude/skills/launch-review/scripts/check-data-access-rules.mjs', script);
  const out = path.join(dir, 'r.json');
  const res = spawnSync(process.execPath, [script, 'tests/fixtures/data-access', out], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(out), 'the script wrote its result instead of exiting without doing anything');
  assert.ok(JSON.parse(fs.readFileSync(out, 'utf8')).findings.length > 0);
});
