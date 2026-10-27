import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, readCommits, analyse, toMarkdown, FIX } from '../.claude/skills/launch-review/scripts/history-scan.mjs';

test('classify: keywords map to problem classes', () => {
  assert.deepEqual(classify('Fix crash on malformed JSON body'), ['input']);
  assert.ok(classify('Fix double charge when payment provider times out').includes('concurrency'));
  assert.ok(classify('Fix double charge when payment provider times out').includes('external'));
  assert.ok(classify('fix: SALE_STARTS_AT ignored after restart; config read at startup').includes('config'));
  assert.deepEqual(classify('Tidy wording'), ['other']);
});

test('fix detection', () => {
  assert.ok(FIX.test('Fix oversell under load'));
  assert.ok(FIX.test('fix(api): handle null body'));
  assert.ok(FIX.test('Revert "Add caching"'));
  assert.ok(!FIX.test('Add checkout page'));
  assert.ok(!FIX.test('Prefix the log lines'));
});

test('readCommits and analyse on a small repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'history-scan-'));
  try {
    const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    const commit = (file, content, message) => {
      writeFileSync(join(dir, file), content);
      git('add', file);
      git('commit', '-q', '-m', message);
    };
    commit('server.js', '1', 'Add checkout');
    commit('server.js', '2', 'Fix crash on malformed request path');
    commit('server.js', '3', 'Fix double charge on payment timeout\n\nCo-Authored-By: Claude <noreply@anthropic.com>');
    commit('page.js', '1', 'Fix sign-in form not hiding (CSS)');
    commit('page.js', '2', 'Revert "Fix sign-in form not hiding (CSS)"');

    const commits = readCommits(dir);
    assert.equal(commits.length, 5);
    assert.deepEqual(commits[0].files, ['page.js']);

    const issues = [
      { number: 7, title: 'Checkout crashes on empty address', labels: [{ name: 'bug' }], state: 'CLOSED', createdAt: '2026-01-02T00:00:00Z' },
      { number: 8, title: 'Add dark mode', labels: ['enhancement'], state: 'OPEN' },
    ];
    const r = analyse(commits, issues);
    assert.equal(r.totals.commits, 5);
    assert.equal(r.totals.fixes, 4);
    assert.equal(r.totals.reverts, 1);
    assert.equal(r.totals.aiAssisted, 1);
    assert.equal(r.totals.bugIssues, 1);
    const input = r.classes.find((c) => c.key === 'input');
    assert.equal(input.count, 2, 'one commit and one issue');
    assert.ok(input.recurring);
    assert.equal(r.hotspots[0].file, 'server.js');
    assert.equal(r.hotspots[0].fixes, 2);
    assert.ok(r.repeated.some((h) => h.file === 'server.js'));
    const md = toMarkdown(r, { repo: dir });
    assert.match(md, /Bad input and crashes: 2 \(recurring\)/);
    assert.match(md, /leads, not conclusions/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
