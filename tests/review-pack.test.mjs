import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadCatalogue, applicability, validatePack, verdictCeiling, renderPage, templatePack, criteriaMarkdown,
  gate, worksheetStatus, mergeWorksheet, readmeItems, README_ITEMS,
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
  pack.verdict = { decision: extra.decision ?? 'GO', reason: 'r', ifLaunchedNow: 'x', blockers: [], conditions: extra.conditions ?? [] };
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
  pack.verdict.conditions = [{ text: 'Get staging access', who: 'Product owner', refs: [pack.worksheet[0].id] }];
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

test('gates count what is missing instead of trusting a summary', () => {
  const pack = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
  const base = 'demo/flash-sale/review';
  assert.equal(gate('review', pack, catalogue, { baseDir: base }).ok, true);

  // Drop two security rows: the worksheet gate names exactly those two.
  const dropped = pack.worksheet.filter((r) => r.id.startsWith('S-')).slice(0, 2).map((r) => r.id);
  const short = { ...pack, worksheet: pack.worksheet.filter((r) => !dropped.includes(r.id)) };
  const g = gate('worksheet', short, catalogue, { baseDir: base, areas: ['S'] });
  assert.equal(g.ok, false);
  const s = g.checks.find((c) => c.name.startsWith('S:'));
  assert.equal(s.expected - s.found, 2);
  assert.deepEqual(s.missing, dropped);
  assert.equal(gate('worksheet', short, catalogue, { baseDir: base, areas: ['A'] }).ok, true, 'other areas unaffected');

  // A screenshot that doesn't exist fails the submission gate.
  const missingFile = structuredClone(pack);
  missingFile.product.journeys[0].evidence[0].path = 'evidence/nope.png';
  const ev = gate('submission', missingFile, catalogue, { baseDir: base }).checks.find((c) => c.name === 'Evidence files that exist');
  assert.deepEqual(ev.missing, ['evidence/nope.png']);

  // A blocker without a card under What to fix fails the review gate.
  const noCard = structuredClone(pack);
  noCard.verdict.blockers[0].refs = ['A-09'];
  const card = gate('review', noCard, catalogue, { baseDir: base }).checks.find((c) => c.name === 'Blockers with a card in What to fix');
  assert.equal(card.ok, false);
  assert.equal(card.missing.length, 1);

  // An open High that isn't a blocker fails the review gate.
  const noBlocker = structuredClone(pack);
  noBlocker.verdict.blockers = noBlocker.verdict.blockers.filter((b) => !b.refs.includes('ARC-11'));
  const bl = gate('review', noBlocker, catalogue, { baseDir: base }).checks.find((c) => c.name.startsWith('Open Critical'));
  assert.deepEqual(bl.missing, ['ARC-11']);
});

test('README check: the nine items by label, and the link to the review page', () => {
  const full = README_ITEMS.map((l, i) => (i % 2 ? `**${l}:** x` : `## ${l}`)).join('\n') + '\n[page](review/index.html)';
  assert.deepEqual(readmeItems(full).missing, []);
  assert.equal(readmeItems(full).linksPage, true);
  const partial = '# App\n**What it is:** x\n## Quick start\nTests are fun\n';
  const r = readmeItems(partial);
  assert.deepEqual(r.present, ['What it is', 'Quick start']);
  assert.ok(r.missing.includes('Tests'), 'the word "Tests" in a sentence is not the Tests item');
  assert.equal(r.linksPage, false);
});

test('status and merge: worksheet split across lenses', () => {
  const pack = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
  const rows = pack.worksheet;
  const empty = { ...pack, worksheet: [] };
  const before = worksheetStatus(empty, catalogue);
  const mandatory = catalogue.criteria.filter((c) => applicability(c, pack.project) === 'mandatory').length;
  assert.equal(before.reduce((n, a) => n + a.missing.length, 0), mandatory);
  const security = rows.filter((r) => r.id.startsWith('S-'));
  const rest = rows.filter((r) => !r.id.startsWith('S-'));
  const merged = mergeWorksheet(structuredClone(empty), [rest, security]);
  assert.equal(merged.worksheet.length, rows.length);
  assert.deepEqual(merged.worksheet.map((r) => r.id), rows.map((r) => r.id), 'merged rows come back in standard order');
  assert.equal(worksheetStatus(merged, catalogue).every((a) => a.missing.length === 0), true);
  // A later file replaces an earlier row for the same criterion.
  const again = mergeWorksheet(structuredClone(merged), [[{ id: 'S-01', result: 'cannot-verify', needed: 'x' }]]);
  assert.equal(again.worksheet.find((r) => r.id === 'S-01').result, 'cannot-verify');
});

test('numbers in the documents match the catalogue (software counts, not prose)', () => {
  const total = catalogue.criteria.length;
  const example = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
  const applicable = catalogue.criteria.filter((c) => applicability(c, example.project) !== 'off').length;
  const files = ['README.md', 'CHANGELOG.md', 'docs/hand-in-guide.md', '.claude/skills/launch-review/SKILL.md', '.claude/skills/launch-review/standard/review-standard.md', '.claude-plugin/marketplace.json'];
  const patterns = [/(\d+) criteria in nine areas/g, /all (\d+) criteria\]/g, /(\d+)-criterion/g, /review standard \((\d+) criteria\)/g, /through: (\d+) in all/g, /up to (\d+) criteria/g];
  let checked = 0;
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const re of patterns) for (const m of text.matchAll(re)) { checked++; assert.equal(Number(m[1]), total, `${f}: "${m[0]}" but the catalogue has ${total}`); }
    for (const m of text.matchAll(/All (\d+) criteria that apply/g)) { checked++; assert.equal(Number(m[1]), applicable, `${f}: "${m[0]}" but ${applicable} apply to the example`); }
  }
  assert.ok(checked >= 6, 'the count mentions were found');
});

test('the generated criteria list is up to date', () => {
  const md = readFileSync(join('.claude/skills/launch-review/standard/criteria.md'), 'utf8');
  assert.equal(md, criteriaMarkdown(catalogue) + '\n', 'run: node .claude/skills/launch-review/scripts/review-pack.mjs criteria .claude/skills/launch-review/standard/criteria.md');
});
