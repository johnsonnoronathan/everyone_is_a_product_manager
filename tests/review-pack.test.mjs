import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadCatalogue, applicability, validatePack, verdictCeiling, renderPage, templatePack, criteriaMarkdown,
  gate, worksheetStatus, mergeWorksheet, readmeItems, README_ITEMS, scannerHits, personalDataIn,
  inspection, conclusions, reportMarkdown, SECTION_ORDER,
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
  // The lists behind the three questions point only at things that exist.
  const kinds = new Set(catalogue.testKinds.map((k) => k.id));
  for (const list of [catalogue.performanceTests, catalogue.hiddenIssueAreas, catalogue.testKinds, catalogue.evidenceSources]) {
    assert.equal(new Set(list.map((x) => x.id)).size, list.length);
  }
  for (const k of catalogue.performanceTests) {
    assert.ok([1, 2, 3].includes(k.tier), k.id);
    for (const r of k.criteria) assert.ok(ids.includes(r), `${k.id}: ${r}`);
    for (const f of k.when || []) assert.ok(catalogue.features[f], `${k.id}: ${f}`);
  }
  for (const a of catalogue.hiddenIssueAreas) for (const r of a.criteria) assert.ok(ids.includes(r), `${a.id}: ${r}`);
  for (const t of catalogue.toolbox) for (const k of t.kinds) assert.ok(kinds.has(k), `${t.name}: ${k}`);
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
  pack.scans = { output: '../sample-reports/fixed-round2/launch-review/scans', triage: [] };
  pack.architecture = { ...pack.architecture, hiddenChecks: [] };
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

test('an open serious finding limits the verdict even without a failing worksheet row', () => {
  const finding = { id: 'SEC-01', severity: 'Critical', status: 'Open', title: 't', fix: 'f', who: 'Developer', doneWhen: 'd' };
  const pack = reviewedPack([], { tier: 3, findings: [finding] });
  pack.worksheet = allMeet(pack);
  pack.verdict.blockers = [{ text: 'Fix it', who: 'Developer', refs: ['SEC-01'] }];
  assert.equal(verdictCeiling(pack, catalogue).ceiling, 'NO-GO');
  assert.ok(validatePack(pack, catalogue, { stage: 'review' }).some((e) => e.level === 'error' && e.where === 'verdict.decision'), 'GO is refused');
  assert.equal(gate('review', pack, catalogue, { baseDir: 'demo/flash-sale/review' }).ok, false);

  finding.status = 'Fixed: verified on 2026-10-27';
  assert.equal(verdictCeiling(pack, catalogue).ceiling, 'GO', 'a fixed finding no longer counts');
  Object.assign(finding, { status: 'Open', severity: 'High' });
  pack.project.riskTier = 2;
  assert.equal(verdictCeiling(pack, catalogue).ceiling, 'NO-GO');
  finding.accepted = { by: 'Owner', until: '2026-12-01' };
  assert.equal(verdictCeiling(pack, catalogue).ceiling, 'GO WITH CONDITIONS', 'tier 2 may accept a High in writing');
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

test('the three questions are counted from the record, not written by hand', () => {
  const pack = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
  const ins = inspection(pack, catalogue);
  assert.equal(ins.harness.answer, 'No');
  assert.equal(ins.harness.met, pack.worksheet.filter((r) => r.id.startsWith('H-') && r.result === 'meets').length);
  assert.deepEqual(ins.harness.recommend.map((k) => k.id).sort(), ['integration', 'scan', 'self-check', 'unit', 'visual']);
  assert.equal(ins.harness.recommend.find((k) => k.id === 'unit').verb, 'Add', 'no unit test suite in the project');
  assert.equal(ins.harness.recommend.find((k) => k.id === 'integration').verb, 'Run in CI and extend', 'the review scripts exist but CI does not run them');
  const weights = ins.harness.recommend.map((k) => k.weight);
  assert.deepEqual(weights, [...weights].sort((a, b) => b - a), 'most needed first');
  assert.equal(ins.harness.notMet + ins.harness.unverified + ins.harness.met, ins.harness.total);
  assert.equal(ins.performance.answer, 'Partly');
  assert.equal(ins.performance.run, pack.performance.coverage.filter((e) => e.result !== 'not-run').length);
  assert.equal(ins.hidden.answer, 'Yes');
  assert.equal(ins.hidden.found[0].severity, 'High', 'most serious first');
  const said = conclusions(ins);
  assert.match(said.performance, /not run \(beyond capacity, long run, page speed on phones, on a production-like setup\)/);

  // The answer follows the counts: drop places and kinds, and Yes becomes Partly or No.
  pack.architecture.hiddenChecks = pack.architecture.hiddenChecks.slice(0, 4);
  assert.equal(inspection(pack, catalogue).hidden.answer, 'No');
  pack.performance.coverage = pack.performance.coverage.map((e) => ({ ...e, result: 'pass' }));
  assert.equal(inspection(pack, catalogue).performance.answer, 'Yes');
});

test('the review gate counts the records behind the three questions', () => {
  const base = 'demo/flash-sale/review';
  const pack = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
  pack.architecture.hiddenChecks = pack.architecture.hiddenChecks.filter((h) => h.area !== 'time');
  pack.performance.coverage = pack.performance.coverage.filter((e) => e.kind !== 'long-run');
  pack.method.sources = pack.method.sources.filter((x) => x.source !== 'issues');
  delete pack.history.classes[0].catchWith;
  delete pack.harness.suites[0].type;
  const g = gate('review', pack, catalogue, { baseDir: base });
  const missing = (prefix) => g.checks.find((c) => c.name.startsWith(prefix)).missing;
  assert.deepEqual(missing('Places hidden problems'), ['time: Time and dates']);
  assert.deepEqual(missing('Kinds of performance test'), ['long-run: Long run']);
  assert.deepEqual(missing('Sources of evidence'), ['issues: Issue tracker or tickets']);
  assert.equal(missing('Recurring problems').length, 1);
  assert.deepEqual(missing('Test suites with a type'), ['Acceptance tests']);
  // The performance lens alone is held to its part.
  const w = gate('worksheet', pack, catalogue, { baseDir: base, areas: ['P'] });
  assert.ok(w.checks.some((c) => c.name.startsWith('Kinds of performance test') && !c.ok));
  assert.ok(!w.checks.some((c) => c.name.startsWith('Places hidden problems')));

  // A place recorded as "found" must point at real problems.
  const bad = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
  bad.architecture.hiddenChecks[1].refs = ['ARC-99'];
  assert.ok(validatePack(bad, catalogue, { stage: 'review' }).some((e) => e.where.startsWith('architecture.hiddenChecks') && e.message.includes('ARC-99')));
});

test('the written report follows the inspection order: summary, method, results, recommendations, limits', () => {
  const md = reportMarkdown(JSON.parse(readFileSync(EXAMPLE, 'utf8')), catalogue);
  const at = (h) => { const i = md.indexOf(h); assert.ok(i >= 0, h); return i; };
  const order = ['## 1. Summary: evidence and conclusions', '## 2. How the inspection was done', '## 3. Results', '### 3.1 Is the test harness properly set up? No', '### 3.2 Are the performance tests comprehensive? Partly', '### 3.3 Does the architecture review cover hidden problems? Yes', '## 4. Recommendations', '### Strengthen the test harness', '### Skills and tools the team can use', '## 5. Limits', '## Appendix A. Every open problem'];
  order.reduce((prev, h) => { const i = at(h); assert.ok(i > prev, `${h} comes later`); return i; }, -1);
  assert.match(md, /\*\*Add visual tests\.\*\* Would catch: Screen behaviour no test looked at closely\./);
  assert.match(md, /\*These answers measure how complete the testing and the inspection are, not whether the app is ready/);
  assert.match(md, /- \*\*Done when:\*\* /, 'the developer appendix says how to tell a fix is done');
  assert.match(md, /\| Issue tracker or tickets \| No \| None exists/);
});

test('render: all sections, escaped text, embedded screenshots, fragment mode', () => {
  const pack = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
  pack.project.summary = 'A <script>alert(1)</script> shop with `code`';
  const html = renderPage(pack, { baseDir: 'demo/flash-sale/review', catalogue });
  const positions = SECTION_ORDER.review.map((id) => html.indexOf(`<section id="${id}">`));
  positions.forEach((pos, i) => assert.ok(pos > (positions[i - 1] ?? -1), `${SECTION_ORDER.review[i]} in its place`));
  assert.ok(html.includes('Pre-delivery inspection'));
  for (const id of ['q-harness', 'q-performance', 'q-hidden']) assert.ok(html.includes(`id="${id}"`), id);
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

test('hand-in gate: saved text evidence holds test data only', () => {
  assert.deepEqual(personalDataIn('{"email":"shopper@example.com","b":"x@shop.test","c":"admin@localhost"}'), []);
  assert.deepEqual(personalDataIn('{"logo":"/img/logo@2x.png","help":"support@shop.com"}'), [], 'image names and role addresses are not personal data');
  const found = personalDataIn('{"email":"Jane.Doe@Gmail.com","key":"sk_live_abcdefghijklmnop"}');
  assert.equal(found.length, 2);
  assert.ok(found[0].includes('gmail.com') && !found.join(' ').includes('Jane.Doe'), 'describes the find without printing it');
  assert.ok(!found.join(' ').includes('sk_live_abcdef'), 'never prints the key');

  const dir = mkdtempSync(join(tmpdir(), 'handin-'));
  try {
    writeFileSync(join(dir, 'answer.json'), '{"customer":"jane@gmail.com"}');
    writeFileSync(join(dir, 'clean.json'), '{"customer":"buyer1@example.com"}');
    const pack = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
    pack.product.journeys = [{ id: 'J1', name: 'Buy', evidence: [{ path: 'answer.json' }, { path: 'clean.json' }] }];
    pack.acceptance.rows = [];
    const c = gate('submission', pack, catalogue, { baseDir: dir }).checks.find((x) => x.name.startsWith('Saved text evidence'));
    assert.equal(c.ok, false);
    assert.deepEqual(c.missing, ['answer.json: an email address at gmail.com (use example.com or a .test domain)']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scanner gate: every rule that fired is reported or dismissed', () => {
  const pack = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
  const base = 'demo/flash-sale/review';
  const dir = mkdtempSync(join(tmpdir(), 'scans-'));
  try {
    // A real review once saw a blocking file read in Semgrep's output and the system map, and never reported it.
    writeFileSync(join(dir, 'semgrep.json'), JSON.stringify({ results: [
      { check_id: 'rules.sql-built-from-strings-js', path: '/w/app/server.mjs', start: { line: 98 } },
      { check_id: 'rules.sync-io-in-request-handler', path: '/w/app/server.mjs', start: { line: 68 } },
      { check_id: 'rules.sync-io-in-request-handler', path: '/w/app/server.mjs', start: { line: 72 } },
    ] }));
    writeFileSync(join(dir, 'gitleaks-files.json'), JSON.stringify([{ RuleID: 'generic-api-key', File: 'app/server.mjs', StartLine: 10 }]));
    writeFileSync(join(dir, 'osv.json'), JSON.stringify({ results: [] }));
    writeFileSync(join(dir, 'data-access-rules.json'), JSON.stringify({ findings: [{ severity: 'Critical', rule: 'firebase-public-write', file: 'firestore.rules', line: 4, issue: 'open' }] }));
    const hits = scannerHits(dir);
    assert.equal(hits.length, 4, 'grouped by tool and rule');
    assert.deepEqual(hits.find((h) => h.tool === 'data-access-rules').where, ['firestore.rules:4']);
    assert.deepEqual(hits.find((h) => h.rule === 'sync-io-in-request-handler').where, ['app/server.mjs:68', 'app/server.mjs:72']);

    const p = structuredClone(pack);
    p.scans.triage = [
      { tool: 'semgrep', rule: 'sql-built-from-strings-js', outcome: 'reported', ref: 'SEC-06' },
      { tool: 'gitleaks', rule: 'generic-api-key', outcome: 'dismissed', reason: 'test fixture' },
      { tool: 'data-access-rules', rule: 'firebase-public-write', outcome: 'reported', ref: 'SEC-06' },
    ];
    const c = gate('review', p, catalogue, { baseDir: base, scans: dir }).checks.find((x) => x.name.startsWith('Scanner rules'));
    assert.equal(c.ok, false);
    assert.deepEqual(c.missing, ['semgrep sync-io-in-request-handler (app/server.mjs:68, app/server.mjs:72)']);

    p.scans.triage.push({ tool: 'semgrep', rule: 'sync-io-in-request-handler', outcome: 'reported', ref: 'P-07' });
    assert.equal(gate('review', p, catalogue, { baseDir: base, scans: dir }).ok, true);

    // No scanner output at all fails too.
    const none = gate('review', pack, catalogue, { baseDir: base, scans: join(dir, 'nope') }).checks.find((x) => x.name === 'Scanner output found');
    assert.equal(none.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // A triage entry must point at something real, or say why the hit is harmless.
  const bad = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
  bad.scans.triage = [{ tool: 'semgrep', rule: 'x', outcome: 'reported', ref: 'SEC-99' }, { tool: 'semgrep', rule: 'y', outcome: 'dismissed' }];
  const errs = validatePack(bad, catalogue, { stage: 'review' }).filter((e) => e.where.startsWith('scans.triage'));
  assert.equal(errs.length, 2);
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
