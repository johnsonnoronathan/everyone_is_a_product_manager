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
