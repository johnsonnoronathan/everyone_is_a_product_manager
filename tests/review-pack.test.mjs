import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadCatalogue, applicability, validatePack, verdictCeiling, renderPage, templatePack, criteriaMarkdown,
} from '../.claude/skills/launch-review/scripts/review-pack.mjs';

const catalogue = loadCatalogue();
const EXAMPLE = 'demo/flash-sale/review/review-pack.json';

test('catalogue: unique ids, known areas and features, valid tiers and grades', () => {
  const ids = catalogue.criteria.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  const areas = new Set(catalogue.areas.map((a) => a.code));
  for (const c of catalogue.criteria) {
    assert.match(c.id, /^[A-Z]-\d\d$/);
    assert.ok(areas.has(c.id[0]), c.id);
    assert.ok([1, 2, 3].includes(c.tier), c.id);
    assert.ok(['A', 'B', 'C'].includes(c.minGrade), c.id);
    assert.ok(c.title && c.standard && c.evidence, c.id);
    for (const f of c.when || []) assert.ok(catalogue.features[f], `${c.id}: ${f}`);
  }
});

test('applicability: tier and feature conditions', () => {
  const s04 = catalogue.criteria.find((c) => c.id === 'S-04'); // browserDatabase, tier 1
  const p08 = catalogue.criteria.find((c) => c.id === 'P-08'); // tier 3
  assert.equal(applicability(s04, { riskTier: 3, features: [] }), 'off');
  assert.equal(applicability(s04, { riskTier: 1, features: ['browserDatabase'] }), 'mandatory');
  assert.equal(applicability(p08, { riskTier: 2, features: [] }), 'recommended');
  assert.equal(applicability(p08, { riskTier: 3, features: [] }), 'mandatory');
});

test('a fresh template is not a complete submission', () => {
  const pack = templatePack(catalogue, { tier: 2, features: ['money'] });
  const errors = validatePack(pack, catalogue, { stage: 'submission' }).filter((p) => p.level === 'error');
  assert.ok(errors.some((e) => e.where === 'project.name'));
  assert.ok(errors.some((e) => e.where === 'rules'), 'money requires business rules');
  assert.ok(pack.worksheet.every((r) => applicability(catalogue.criteria.find((c) => c.id === r.id), pack.project) === 'mandatory'));
});

function reviewedPack(rows, extra = {}) {
  const pack = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
  pack.project.riskTier = extra.tier ?? 2;
  pack.worksheet = rows;
  pack.verdict = { decision: extra.decision ?? 'GO', reason: 'r', blockers: [], conditions: extra.conditions ?? [] };
  pack.findings = extra.findings ?? [];
  return pack;
}
const allMeet = (pack) => catalogue.criteria
  .filter((c) => applicability(c, pack.project) === 'mandatory')
  .map((c) => ({ id: c.id, result: 'meets', grade: 'A', evidence: 'run' }));

test('verdict ceiling follows the severity rules', () => {
  let pack = reviewedPack([]);
  pack.worksheet = allMeet(pack);
  assert.equal(verdictCeiling(pack, catalogue).ceiling, 'GO');

  pack.worksheet[0] = { ...pack.worksheet[0], result: 'cannot-verify', needed: 'x' };
  assert.equal(verdictCeiling(pack, catalogue).ceiling, 'GO WITH CONDITIONS');

  pack.worksheet[1] = { id: pack.worksheet[1].id, result: 'does-not-meet', severity: 'High', evidence: 'x' };
  assert.equal(verdictCeiling(pack, catalogue).ceiling, 'NO-GO');
  pack.worksheet[1].accepted = { by: 'Owner', until: '2026-12-01' };
  assert.equal(verdictCeiling(pack, catalogue).ceiling, 'GO WITH CONDITIONS', 'tier 2 may accept a High in writing');
  pack.project.riskTier = 3;
  assert.equal(verdictCeiling(pack, catalogue).ceiling, 'NO-GO', 'tier 3 never accepts a High');
});

test('validator rejects a verdict the worksheet does not allow, and weak evidence', () => {
  const pack = reviewedPack([]);
  pack.worksheet = allMeet(pack);
  pack.worksheet[0] = { id: pack.worksheet[0].id, result: 'does-not-meet', severity: 'Critical', evidence: 'x' };
  pack.worksheet[1] = { id: 'R-02', result: 'meets', grade: 'C', evidence: 'the README says so' };
  const errors = validatePack(pack, catalogue, { stage: 'review' }).filter((p) => p.level === 'error');
  assert.ok(errors.some((e) => e.where === 'verdict.decision' && /at most NO-GO/.test(e.message)));
  assert.ok(errors.some((e) => /Grade C evidence can't support/.test(e.message)));
});

test('GO WITH CONDITIONS must list every mandatory criterion that could not be verified', () => {
  const pack = reviewedPack([], { decision: 'GO WITH CONDITIONS' });
  pack.worksheet = allMeet(pack);
  pack.worksheet[0] = { id: pack.worksheet[0].id, result: 'cannot-verify', needed: 'staging access' };
  let errors = validatePack(pack, catalogue, { stage: 'review' }).filter((p) => p.level === 'error');
  assert.ok(errors.some((e) => e.where === 'verdict.conditions'));
  pack.verdict.conditions = [{ text: 'Get staging access', refs: [pack.worksheet[0].id] }];
  errors = validatePack(pack, catalogue, { stage: 'review' }).filter((p) => p.level === 'error');
  assert.deepEqual(errors, []);
});

test('the worked example is a complete review, and its NO-GO is allowed', () => {
  const pack = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
  assert.deepEqual(validatePack(pack, catalogue, { stage: 'review' }).filter((p) => p.level === 'error'), []);
  assert.equal(verdictCeiling(pack, catalogue).ceiling, 'NO-GO');
});

test('render: all sections, escaped text, embedded screenshots, fragment mode', () => {
  const pack = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
  pack.project.summary = 'A <script>alert(1)</script> shop with `code`';
  const html = renderPage(pack, { baseDir: 'demo/flash-sale/review', catalogue });
  for (const id of ['verdict', 'product', 'demo', 'run', 'requirements', 'architecture', 'rules', 'harness', 'performance', 'security', 'operations', 'history', 'acceptance', 'findings', 'limits', 'glossary']) {
    assert.ok(html.includes(`<section id="${id}">`), id);
  }
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('<code>code</code>'));
  assert.ok(html.includes('data:image/png;base64,'), 'screenshots are embedded');
  assert.ok(html.startsWith('<!doctype html>'));
  const fragment = renderPage(pack, { baseDir: 'demo/flash-sale/review', catalogue, fragment: true });
  assert.ok(fragment.startsWith('<title>'));
  assert.ok(!fragment.includes('mermaid.min.js'));
});

test('the generated criteria list is up to date', () => {
  const md = readFileSync(join('.claude/skills/launch-review/standard/criteria.md'), 'utf8');
  assert.equal(md, criteriaMarkdown(catalogue) + '\n', 'run: node .claude/skills/launch-review/scripts/review-pack.mjs criteria .claude/skills/launch-review/standard/criteria.md');
});
