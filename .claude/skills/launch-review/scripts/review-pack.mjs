#!/usr/bin/env node
// Review pack: check it against the review standard and render it as one self-contained web page.
//
//   node review-pack.mjs validate <pack.json> [--stage submission|review]
//   node review-pack.mjs gate     <submission|worksheet|review> <pack.json> [--areas S,A] [--readme README.md] [--scans dir]   (counts; exit 1 if anything is missing)
//   node review-pack.mjs render   <pack.json> <out.html> [--fragment]
//   node review-pack.mjs report   <pack.json> <REPORT.md>     (the written inspection report, generated from the same record)
//   node review-pack.mjs compare  <first.json> <second.json> [out.md]   (how far two inspections agree, question by question)
//   node review-pack.mjs template <out.json> [--tier 1|2|3] [--features money,accounts,...] [--stage review]
//   node review-pack.mjs status   <pack.json>                  (per area: results so far, mandatory criteria still missing)
//   node review-pack.mjs merge    <pack.json> <rows.json>...   (add worksheet rows written by each reviewer or lens)
//   node review-pack.mjs criteria <out.md>
//
// The standard is described in ../standard/review-standard.md; the criteria are in ../standard/criteria.json.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CATALOGUE_PATH = join(HERE, '..', 'standard', 'criteria.json');

export const RESULTS = {
  'meets': 'Meets',
  'does-not-meet': 'Does not meet',
  'cannot-verify': 'Cannot verify',
  'not-applicable': 'Not applicable',
};
export const DECISIONS = ['GO', 'GO WITH CONDITIONS', 'NO-GO'];
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const GRADE_RANK = { A: 3, B: 2, C: 1 };

export function loadCatalogue(path = CATALOGUE_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// A value counts as filled in when it is non-empty and not a template placeholder.
const filled = (v) => {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '' && !/^TODO\b/i.test(v.trim());
  if (Array.isArray(v)) return v.length > 0;
  return true;
};

// mandatory: required at this tier; recommended: applies but only required at a higher tier; off: feature absent.
export function applicability(criterion, project = {}) {
  const features = new Set(project.features || []);
  if (criterion.when && !criterion.when.some((f) => features.has(f))) return 'off';
  return criterion.tier <= Number(project.riskTier || 3) ? 'mandatory' : 'recommended';
}

// ---------- yes/no questions: results, severity and points worked out by software ----------
// Each criterion is a short list of yes/no questions ("yes" is the good answer), each with the severity a "no" means.
// The reviewer answers; the software works out the result, the severity and the points, so two reviews of the same
// project land on the same results whenever they agree on the facts.
export const ANSWER_VALUES = ['yes', 'no', 'unknown', 'n/a'];
const RESOLVED = Symbol('resolved');

export function rowOutcome(row = {}, criterion = {}) {
  const checks = criterion.checks || [];
  const answers = row.answers || {};
  const given = checks.map((c) => ({ c, a: answers[c.id] }));
  const unanswered = given.filter((x) => !ANSWER_VALUES.includes(x.a)).map((x) => x.c.id);
  const noes = given.filter((x) => x.a === 'no');
  const counted = given.filter((x) => x.a === 'yes' || x.a === 'no' || x.a === 'unknown');
  let result;
  if (row.result === 'not-applicable' && !counted.length) result = 'not-applicable';
  else if (!row.answers) result = undefined;
  else if (unanswered.length) result = undefined;
  else if (noes.length) result = 'does-not-meet';
  else if (given.some((x) => x.a === 'unknown')) result = 'cannot-verify';
  else if (!counted.length) result = 'not-applicable';
  else result = 'meets';
  const computedSeverity = noes.length ? SEVERITIES[Math.min(...noes.map((x) => SEVERITIES.indexOf(x.c.ifNo)))] : undefined;
  const severity = result === 'does-not-meet' ? (row.severity && filled(row.severityReason) ? row.severity : computedSeverity) : undefined;
  return {
    result, severity, computedSeverity,
    yes: counted.filter((x) => x.a === 'yes').length, counted: counted.length,
    unanswered: result === 'not-applicable' ? [] : unanswered, noes: noes.map((x) => x.c.id),
  };
}

// The pack as the software reads it: every answered row gets its worked-out result and severity.
export function resolvePack(pack, catalogue) {
  if (pack[RESOLVED]) return pack;
  const byId = new Map(catalogue.criteria.map((c) => [c.id, c]));
  const worksheet = (pack.worksheet || []).map((r) => {
    const c = byId.get(r.id);
    if (!c || !r.answers) return r;
    const o = rowOutcome(r, c);
    return { ...r, result: o.result, severity: o.severity };
  });
  const out = { ...pack, worksheet };
  Object.defineProperty(out, RESOLVED, { value: true });
  return out;
}

// Points: one per question answered yes, out of every question of the mandatory criteria (unanswered ones count
// against the total, so skipping a question can't raise the score). Whole criteria marked not applicable are left out.
export function checklistPoints(pack, catalogue) {
  const rows = new Map((pack.worksheet || []).map((r) => [r.id, r]));
  const areas = catalogue.areas.map((a) => {
    let yes = 0, total = 0;
    for (const c of catalogue.criteria.filter((x) => x.id.startsWith(a.code + '-') && applicability(x, pack.project) === 'mandatory')) {
      const r = rows.get(c.id);
      const o = rowOutcome(r || {}, c);
      if (o.result === 'not-applicable') continue;
      yes += o.yes;
      total += r?.answers ? o.counted + o.unanswered.length : (c.checks || []).length;
    }
    return { code: a.code, name: a.name, yes, total };
  });
  return { areas, yes: areas.reduce((n, a) => n + a.yes, 0), total: areas.reduce((n, a) => n + a.total, 0) };
}

function severityOf(row, findings) {
  if (row.severity) return row.severity;
  const f = row.finding && findings.find((x) => x.id === row.finding);
  return f ? f.severity : undefined;
}

// The most favourable verdict the worksheet allows (rules in severity.md and review-standard.md).
export function verdictCeiling(pack, catalogue) {
  pack = resolvePack(pack, catalogue);
  const findings = pack.findings || [];
  const tier = Number(pack.project?.riskTier || 3);
  const reasons = [];
  let ceiling = 'GO';
  const lower = (to, why) => {
    if (DECISIONS.indexOf(to) > DECISIONS.indexOf(ceiling)) ceiling = to;
    reasons.push(why);
  };
  const rows = new Map((pack.worksheet || []).map((r) => [r.id, r]));
  for (const c of catalogue.criteria) {
    const app = applicability(c, pack.project);
    const row = rows.get(c.id);
    if (app === 'off') continue;
    if (app === 'mandatory' && (!row || !row.result || row.result === 'cannot-verify')) {
      lower('GO WITH CONDITIONS', `${c.id} is mandatory and ${row?.result ? 'could not be verified' : 'has no result'}`);
    }
    if (row?.result === 'does-not-meet') {
      const sev = severityOf(row, findings);
      if (sev === 'Critical') lower('NO-GO', `${c.id} fails at Critical`);
      else if (sev === 'High') {
        if (tier >= 3 || !row.accepted) lower('NO-GO', `${c.id} fails at High${tier >= 3 ? ' (tier 3: never accepted)' : ' and is not risk-accepted'}`);
        else lower('GO WITH CONDITIONS', `${c.id} fails at High, risk-accepted by ${row.accepted.by}`);
      }
    }
  }
  // An open finding counts too, even when no failing worksheet row points at it: a Critical can't sit beside a GO.
  const linked = new Set((pack.worksheet || []).filter((r) => r.result === 'does-not-meet' && r.finding).map((r) => r.finding));
  for (const f of findings) {
    if (/^fixed/i.test(f.status || '') || linked.has(f.id)) continue;
    if (f.severity === 'Critical') lower('NO-GO', `${f.id} is an open Critical finding`);
    else if (f.severity === 'High') {
      if (tier >= 3 || !f.accepted) lower('NO-GO', `${f.id} is an open High finding${tier >= 3 ? ' (tier 3: never accepted)' : ' and is not risk-accepted'}`);
      else lower('GO WITH CONDITIONS', `${f.id} is High, risk-accepted by ${f.accepted.by}`);
    }
  }
  return { ceiling, reasons };
}

// ---------- the inspection: three questions, answered by software ----------
// The questions an owner asks before delivering a project. Each answer is counted from the record, so it can't drift
// from the evidence: everything done is "Yes", at least half "Partly", less than half "No".
export const QUESTIONS = {
  harness: { title: 'Is the test harness properly set up?', short: 'Test harness', why: 'The tests, automatic checks and AI-agent instructions that stop the next change, by a person or an AI agent, from breaking something or bringing an old bug back.' },
  performance: { title: 'Are the performance tests comprehensive?', short: 'Performance tests', why: 'Whether every kind of performance test this product needs was run. Whether the app passed each one is shown beside it.' },
  hidden: { title: 'Does the architecture review cover hidden problems?', short: 'Hidden problems', why: 'The places where problems usually hide from tests: two things at once, restarts, settings, time and the rest. The review looks in each and says what it found there.' },
};
// The answers grade how thorough the testing and the inspection were. Whether the app is ready is the verdict's job.
export const QUESTIONS_NOTE = 'These answers measure how complete the testing and the inspection are, not whether the app is ready: the verdict says that.';
export const PERF_RESULTS = { pass: 'Passed', fail: 'Failed', 'not-run': 'Not run' };
export const HIDDEN_RESULTS = { found: 'Problems found', 'none-found': 'Looked, none found', 'not-checked': 'Not checked' };
const answerFor = (done, total) => (total === 0 ? 'Not applicable' : done === total ? 'Yes' : done * 2 >= total ? 'Partly' : 'No');
const sevRank = (s) => { const i = SEVERITIES.indexOf(s); return i < 0 ? 9 : i; };

export function inspection(pack, catalogue) {
  pack = resolvePack(pack, catalogue);
  const project = pack.project || {};
  const rows = new Map((pack.worksheet || []).map((r) => [r.id, r]));
  const findings = new Map((pack.findings || []).map((f) => [f.id, f]));

  // 1. The harness checklist, and what the problems that came back say about the kinds of test that are missing.
  const checks = catalogue.criteria.filter((c) => c.id.startsWith('H-') && applicability(c, project) === 'mandatory').map((c) => {
    const r = rows.get(c.id) || {};
    const result = r.result || 'missing';
    const [label, text] = result === 'cannot-verify' || result === 'missing' ? ['Needed to verify', r.needed || ''] : r.fix ? ['Fix', r.fix] : ['Found', r.evidence || ''];
    return { id: c.id, title: c.title, result, label, text };
  });
  const met = checks.filter((x) => x.result === 'meets').length;
  const notMet = checks.filter((x) => x.result === 'does-not-meet').length;
  // The answer is counted on the questions: one point per "yes", out of every question of the mandatory H criteria.
  const hPoints = checklistPoints(pack, catalogue).areas.find((a) => a.code === 'H') || { yes: 0, total: 0 };
  const questions = catalogue.criteria.filter((c) => c.id.startsWith('H-') && applicability(c, project) === 'mandatory').flatMap((c) => {
    const r = rows.get(c.id) || {};
    if (r.result === 'not-applicable') return [];
    return (c.checks || []).map((q) => ({ id: q.id, q: q.q, criterion: c.id, answer: r.answers?.[q.id] || (r.answers ? 'missing' : r.result === 'meets' ? 'yes' : 'missing') }));
  });
  const classes = pack.history?.classes || [];
  const suites = pack.harness?.suites || [];
  const testKinds = (catalogue.testKinds || []).map((k) => ({
    ...k,
    suites: suites.filter((s) => s.type === k.id).map((s) => s.name),
    needed: classes.filter((c) => (c.catchWith || []).includes(k.id)).map((c) => ({ name: c.name, times: (c.occurrences || []).length, caught: c.status === 'controlled' })),
    skills: (catalogue.toolbox || []).filter((t) => (t.kinds || []).includes(k.id)),
  }));
  // Most-needed first: the kind of test that would catch the most recurrences of problems not yet caught.
  const weight = (k) => k.needed.filter((n) => !n.caught).reduce((sum, n) => sum + n.times, 0);
  const recommend = testKinds.filter((k) => k.needed.some((n) => !n.caught)).map((k) => {
    const inCI = suites.some((x) => x.type === k.id && x.inCI);
    return { ...k, weight: weight(k), verb: !k.suites.length ? 'Add' : inCI ? 'Strengthen' : 'Run in CI and extend' };
  }).sort((a, b) => b.weight - a.weight);

  // 2. Every kind of performance test the product needs, run or not.
  const coverage = new Map((pack.performance?.coverage || []).map((e) => [e.kind, e]));
  const perfKinds = (catalogue.performanceTests || []).map((k) => {
    const e = coverage.get(k.id) || {};
    const app = applicability(k, project);
    return { id: k.id, name: k.name, proves: k.proves, mandatory: app === 'mandatory', off: app === 'off', result: e.result || 'missing', by: e.by || '', note: e.note || '' };
  }).filter((k) => !k.off);
  const due = perfKinds.filter((k) => k.mandatory);
  const ran = due.filter((k) => k.result === 'pass' || k.result === 'fail');

  // 3. The places hidden problems usually sit, each examined or not, and the problems found there.
  const looked = new Map((pack.architecture?.hiddenChecks || []).map((e) => [e.area, e]));
  const areas = (catalogue.hiddenIssueAreas || []).map((a) => {
    const e = looked.get(a.id) || {};
    return { id: a.id, name: a.name, look: a.look, result: e.result || 'missing', how: e.how || '', refs: e.refs || [] };
  });
  const examined = areas.filter((a) => a.result === 'found' || a.result === 'none-found');
  const found = [...new Set(areas.filter((a) => a.result === 'found').flatMap((a) => a.refs))]
    .map((id) => findings.get(id) || { id }).sort((a, b) => sevRank(a.severity) - sevRank(b.severity));

  return {
    harness: { answer: answerFor(hPoints.yes, hPoints.total), yes: hPoints.yes, points: hPoints.total, questions, met, notMet, unverified: checks.length - met - notMet, total: checks.length, checks, testKinds, recurring: classes.length, uncaught: classes.filter((c) => !['controlled', 'partly controlled'].includes(c.status)).length, partly: classes.filter((c) => c.status === 'partly controlled').length, recommend },
    performance: { answer: answerFor(ran.length, due.length), run: ran.length, total: due.length, passed: ran.filter((k) => k.result === 'pass').length, failed: ran.filter((k) => k.result === 'fail').length, kinds: perfKinds },
    hidden: { answer: answerFor(examined.length, areas.length), examined: examined.length, total: areas.length, areas, found },
  };
}

// The sources of evidence the standard expects an inspection to draw on, each with what was used or why not.
export function methodSources(pack, catalogue) {
  const given = new Map((pack.method?.sources || []).map((s) => [s.source, s]));
  return (catalogue.evidenceSources || []).map((s) => ({ ...s, entry: given.get(s.id) }));
}

// Plain-language conclusions, written by software from the counts so they always match them.
// How well the problems that came back are caught now, e.g. "3 have no automatic test that would catch them and 3 are only partly caught".
export function recurringText(h) {
  if (!h.recurring) return '';
  const parts = [h.uncaught ? `${h.uncaught} ha${h.uncaught === 1 ? 's' : 've'} no automatic test that would catch ${h.uncaught === 1 ? 'it' : 'them'}` : '', h.partly ? `${h.partly} ${h.partly === 1 ? 'is' : 'are'} only partly caught` : ''].filter(Boolean);
  return parts.length ? `of the ${h.recurring} kinds of problem that came back, ${parts.join(' and ')}` : `all ${h.recurring} kinds of problem that came back are caught by automatic tests`;
}

// One harness recommendation in plain words: what to do, which problems it answers, and what that kind of test catches.
export function recommendText(k) {
  const what = { Add: `Add ${k.name.toLowerCase()}.`, Strengthen: `Strengthen the ${k.name.toLowerCase()}.`, 'Run in CI and extend': `Run the ${k.name.toLowerCase()} on every change (CI), and extend them.` }[k.verb];
  return { what, forWhat: `Would catch: ${k.needed.filter((n) => !n.caught).map((n) => n.name).join('; ')}.`, catches: `${k.name} catch ${k.catches.charAt(0).toLowerCase()}${k.catches.slice(1)}` };
}

export function conclusions(ins) {
  const h = ins.harness, p = ins.performance, x = ins.hidden;
  const names = (list) => list.map((k) => k.name.toLowerCase()).join(', ');
  const notRun = p.kinds.filter((k) => k.mandatory && !(k.result === 'pass' || k.result === 'fail'));
  const notLooked = x.areas.filter((a) => !(a.result === 'found' || a.result === 'none-found'));
  const optionalRun = p.kinds.filter((k) => !k.mandatory && (k.result === 'pass' || k.result === 'fail')).length;
  return {
    harness: h.answer === 'Not applicable' ? 'No harness check is required for this product at its risk tier.' : h.answer === 'Yes'
      ? `The test harness is properly set up: all ${h.points} harness questions are answered yes${h.uncaught + h.partly ? `, though ${recurringText(h)}` : ''}.`
      : `The test harness is ${h.answer === 'No' ? 'not' : 'only partly'} set up: ${h.yes} of ${h.points} harness questions are answered yes (${h.met} of ${h.total} checks fully met)${h.uncaught + h.partly ? `, and ${recurringText(h)}` : ''}. Expect the same bugs to return after the next change.`,
    performance: p.answer === 'Not applicable' ? `No performance test is required for this product at its risk tier${p.kinds.length ? `; ${optionalRun} of the ${p.kinds.length} recommended kinds were run` : ''}.` : (p.answer === 'Yes' ? `Every kind of performance test this product needs was run.` : `The performance tests are ${p.answer === 'No' ? 'not' : 'not fully'} comprehensive: ${notRun.length} of ${p.total} kinds this product needs were not run (${names(notRun)}).`)
      + (p.failed ? ` ${p.failed} of the ${p.run} that were run failed (see each).` : p.run ? ` All ${p.run} that were run passed.` : ''),
    hidden: x.answer === 'Not applicable' ? 'No place for hidden problems is listed in the standard.' : (x.answer === 'Yes' ? `The review looked in all ${x.total} places where hidden problems usually sit.` : `The review did not look in ${notLooked.length} of ${x.total} places where hidden problems usually sit (${names(notLooked)}); problems may remain there.`)
      + (x.found.length ? ` It found ${x.found.length} problem${x.found.length === 1 ? '' : 's'} there.` : ' It found none.'),
  };
}

export function validatePack(pack, catalogue, { stage } = {}) {
  stage = stage || pack.stage || 'submission';
  const raw = pack;
  pack = resolvePack(pack, catalogue);
  const problems = [];
  const err = (where, message) => problems.push({ level: 'error', where, message });
  const warn = (where, message) => problems.push({ level: 'warning', where, message });
  const need = (v, where, message) => { if (!filled(v)) err(where, message); };

  const p = pack.project || {};
  need(p.name, 'project.name', 'Name the product.');
  need(p.summary, 'project.summary', 'Say in a paragraph what the product does and for whom.');
  need(p.commit, 'project.commit', 'Give the exact commit under review.');
  need(p.date, 'project.date', 'Date the submission.');
  need(p.author, 'project.author', 'Name the author (person or team) answerable for the submission.');
  if (![1, 2, 3].includes(Number(p.riskTier))) err('project.riskTier', 'Set the risk tier to 1, 2 or 3 (see references/intake.md).');
  if (!Array.isArray(p.features)) err('project.features', 'List the features that switch criteria on (an empty list is fine).');
  else for (const f of p.features) if (!catalogue.features[f]) err('project.features', `Unknown feature "${f}". Known: ${Object.keys(catalogue.features).join(', ')}.`);

  const journeys = pack.product?.journeys;
  if (!filled(journeys)) err('product.journeys', 'Describe at least one user journey, with steps and a screenshot: this is the demo.');
  else journeys.forEach((j, i) => {
    const at = `product.journeys[${i}]`;
    need(j.name, at, 'Name the journey.');
    need(j.steps, at, `Journey "${j.name || i}": list the steps.`);
    need(j.expected, at, `Journey "${j.name || i}": say what the user should end up seeing.`);
    need(j.evidence, at, `Journey "${j.name || i}": attach a screenshot, recording or test result.`);
  });

  const run = pack.run || {};
  need(run.prerequisites, 'run.prerequisites', 'List what must be installed, with versions.');
  need(run.start, 'run.start', 'Give the command that starts the app.');
  need(run.test, 'run.test', 'Give the command that runs the tests.');
  if (!Array.isArray(run.settings)) err('run.settings', 'List every setting the app reads (an empty list if there are none).');

  if (!filled(pack.requirements)) err('requirements', 'Write down the requirements the review judges against, with numbers.');
  else pack.requirements.forEach((r, i) => {
    need(r.text, `requirements[${i}]`, 'Describe the requirement.');
    need(r.target, `requirements[${i}]`, `Requirement "${r.text || i}": give a measurable target.`);
  });

  const arch = pack.architecture || {};
  need(arch.components, 'architecture.components', 'List the components and what each one does.');
  need(arch.entryPoints, 'architecture.entryPoints', 'List every entry point and who may call it.');

  const feats = new Set(p.features || []);
  if ((feats.has('money') || feats.has('limitedStock')) && !filled(pack.rules)) err('rules', 'Write down the business rules (for example "never sell more than the stock").');
  if (!Array.isArray(pack.rules)) err('rules', 'List the business rules (an empty list if there are none).');

  if (!Array.isArray(pack.harness?.suites)) err('harness.suites', 'List the automated test suites (an empty list if there are none).');
  else if (pack.harness.suites.length === 0) warn('harness.suites', 'No automated tests are declared.');
  if (feats.has('aiAssisted') && !(pack.harness && 'agentFile' in pack.harness)) err('harness.agentFile', 'Say where the agent instruction file is, or set it to null if there is none.');

  if (!Array.isArray(pack.history?.known)) err('history.known', 'List the known open problems (an empty list if there are none).');

  if (!filled(pack.acceptance?.rows)) err('acceptance.rows', 'Include the agreed acceptance criteria.');
  else need(pack.acceptance.criteriaVersion, 'acceptance.criteriaVersion', 'Give the version of the agreed criteria.');

  if (stage === 'review') {
    need(p.reviewer, 'project.reviewer', 'Name the reviewer.');
    need(p.reviewedOn, 'project.reviewedOn', 'Date the review.');
    const v = pack.verdict || {};
    if (!DECISIONS.includes(v.decision)) err('verdict.decision', `Give one of: ${DECISIONS.join(', ')}.`);
    need(v.reason, 'verdict.reason', 'Give the reason for the verdict in one or two plain sentences.');
    if (v.decision && v.decision !== 'GO') need(v.ifLaunchedNow, 'verdict.ifLaunchedNow', 'Say in plain words what would happen to customers and money if the app launched anyway.');
    [...(v.blockers || []).map((b, i) => [b, `verdict.blockers[${i}]`]), ...(v.conditions || []).map((b, i) => [b, `verdict.conditions[${i}]`])].forEach(([b, at]) => {
      need(b.text, at, 'Say what has to happen, in plain words.');
      need(b.who, at, `"${(b.text || '').slice(0, 50)}…": say who does it (a name, or a role such as "developer", "hosting provider", "product owner").`);
    });
    if (!Array.isArray(pack.notChecked)) err('notChecked', 'List what was not checked.');
    else if (pack.notChecked.length === 0) warn('notChecked', 'Nothing is listed as not checked. That is rarely true.');

    const known = new Map(catalogue.criteria.map((c) => [c.id, c]));
    const findings = pack.findings || [];
    const findingIds = new Set(findings.map((f) => f.id));
    need(pack.scans?.output, 'scans.output', 'Say where the scanner output is (the folder run-scanners.sh wrote, relative to this file).');
    (pack.scans?.triage || []).forEach((t, i) => {
      const at = `scans.triage[${i}] ${t.tool || ''} ${t.rule || ''}`.trim();
      if (!t.tool || !t.rule) err(at, 'Give the tool and the rule that fired.');
      if (t.outcome === 'reported') {
        if (!findingIds.has(t.ref) && !known.has(t.ref)) err(at, `"reported" needs a ref to a finding or criterion in this pack (got "${t.ref || ''}").`);
      } else if (t.outcome === 'dismissed') need(t.reason, at, 'Say in one line why this hit is not a problem here.');
      else err(at, 'Set outcome to "reported" (with a ref) or "dismissed" (with a reason).');
    });
    const kindIds = (catalogue.testKinds || []).map((k) => k.id);
    (pack.harness?.suites || []).forEach((s, i) => {
      if (s.type && !kindIds.includes(s.type)) err(`harness.suites[${i}] ${s.name || ''}`.trim(), `Unknown test type "${s.type}". Use one of: ${kindIds.join(', ')}.`);
    });
    (pack.history?.classes || []).forEach((c, i) => (c.catchWith || []).forEach((k) => {
      if (!kindIds.includes(k)) err(`history.classes[${i}] ${c.name || ''}`.trim(), `Unknown kind of test "${k}" in catchWith. Use: ${kindIds.join(', ')}.`);
    }));
    const perfIds = (catalogue.performanceTests || []).map((k) => k.id);
    (pack.performance?.coverage || []).forEach((e, i) => {
      const at = `performance.coverage[${i}] ${e.kind || ''}`.trim();
      if (!perfIds.includes(e.kind)) err(at, `Unknown kind of performance test. Use one of: ${perfIds.join(', ')}.`);
      if (!PERF_RESULTS[e.result]) err(at, 'Set result to "pass", "fail" or "not-run".');
      need(e.note, at, e.result === 'not-run' ? 'Say why it was not run.' : 'Say in one line what the test showed.');
    });
    const areaIds = (catalogue.hiddenIssueAreas || []).map((a) => a.id);
    (pack.architecture?.hiddenChecks || []).forEach((h, i) => {
      const at = `architecture.hiddenChecks[${i}] ${h.area || ''}`.trim();
      if (!areaIds.includes(h.area)) err(at, `Unknown place. Use one of: ${areaIds.join(', ')}.`);
      if (!HIDDEN_RESULTS[h.result]) err(at, 'Set result to "found", "none-found" or "not-checked".');
      need(h.how, at, h.result === 'not-checked' ? 'Say why it was not checked.' : 'Say how you looked.');
      if (h.result === 'found') {
        if (!filled(h.refs)) err(at, '"found" needs the codes of the problems found, in refs.');
        else for (const r of h.refs) if (!findingIds.has(r)) err(at, `"${r}" is not a finding in this pack.`);
      }
    });
    const sourceIds = (catalogue.evidenceSources || []).map((x) => x.id);
    (pack.method?.sources || []).forEach((x, i) => {
      const at = `method.sources[${i}] ${x.source || ''}`.trim();
      if (!sourceIds.includes(x.source)) err(at, `Unknown source. Use one of: ${sourceIds.join(', ')}.`);
      if (typeof x.used !== 'boolean') err(at, 'Set used to true or false.');
      need(x.detail, at, x.used ? 'Say what was used: which version, how many, which period.' : 'Say why it was not used, for example "none exists".');
    });
    const seen = new Set();
    (pack.worksheet || []).forEach((r, i) => {
      const at = `worksheet[${i}] ${r.id || ''}`.trim();
      const c = known.get(r.id);
      if (!c) return err(at, `Unknown criterion "${r.id}".`);
      if (seen.has(r.id)) err(at, 'Criterion appears twice.');
      seen.add(r.id);
      const given = (raw.worksheet || [])[i] || r;
      if (given.answers) {
        const ids = (c.checks || []).map((x) => x.id);
        for (const [k, a] of Object.entries(given.answers)) {
          if (!ids.includes(k)) err(at, `Unknown question "${k}". This criterion's questions are ${ids.join(', ')}.`);
          else if (!ANSWER_VALUES.includes(a)) err(at, `${k}: answer yes, no, unknown or n/a.`);
        }
        const o = rowOutcome(given, c);
        if (o.unanswered.length) return err(at, `Answer every question: ${o.unanswered.join(', ')} ${o.unanswered.length === 1 ? 'has' : 'have'} no answer.`);
        if (given.result && given.result !== o.result) err(at, `The answers make this "${o.result}", but the row says "${given.result}". Leave result out: it is worked out from the answers.`);
        if (Object.values(given.answers).includes('unknown')) need(given.needed, at, 'Say what is needed to answer the questions marked unknown.');
        if (Object.values(given.answers).includes('n/a')) need(given.note, at, 'Say why the questions marked n/a do not apply.');
        if (given.severity && o.computedSeverity && given.severity !== o.computedSeverity) {
          if (!filled(given.severityReason)) err(at, `The answers make this ${o.computedSeverity}, not ${given.severity}. To move it one level for this product, give the reason in severityReason.`);
          else if (Math.abs(SEVERITIES.indexOf(given.severity) - SEVERITIES.indexOf(o.computedSeverity)) > 1) err(at, `The answers make this ${o.computedSeverity}; severity can move one level from there, not to ${given.severity}.`);
        }
      }
      if (!RESULTS[r.result]) return err(at, `Result must be one of: ${Object.keys(RESULTS).join(', ')}.`);
      if (r.finding && !findingIds.has(r.finding)) err(at, `Finding ${r.finding} is not in the findings list.`);
      if (r.result === 'meets') {
        need(r.evidence, at, 'A "meets" result needs evidence.');
        if (!GRADE_RANK[r.grade]) err(at, 'Give the evidence grade (A, B or C).');
        else if (GRADE_RANK[r.grade] < GRADE_RANK[c.minGrade]) err(at, `Grade ${r.grade} evidence can't support "meets": this criterion needs grade ${c.minGrade} or better.`);
      }
      if (r.result === 'does-not-meet') {
        const sev = severityOf(r, findings);
        if (!SEVERITIES.includes(sev)) err(at, 'A failed criterion needs a severity, directly or through its finding.');
        const linked = r.finding && findings.find((x) => x.id === r.finding);
        if (linked && r.severity && SEVERITIES.indexOf(linked.severity) > SEVERITIES.indexOf(r.severity) && !/^fixed/i.test(linked.status || '')) {
          err(at, `Finding ${linked.id} is ${linked.severity}, but the answers make ${r.id} ${r.severity}. Raise the finding to ${r.severity}, or move the row one level with severityReason.`);
        }
        need(r.evidence, at, 'Say what was found.');
        if (!r.finding) need(r.fix, at, 'Say what would fix it, or link a finding that does.');
        if ((sev === 'Medium' || sev === 'Low') && pack.verdict?.decision !== 'NO-GO' && !(filled(r.owner) && filled(r.due))) {
          err(at, `An open ${sev} needs an owner and a due date before a GO or GO WITH CONDITIONS.`);
        }
      }
      if (r.result === 'cannot-verify') need(r.needed, at, 'Say what is needed to verify it.');
      if (r.result === 'not-applicable') need(r.note, at, 'Say why it does not apply.');
    });
    for (const c of catalogue.criteria) {
      if (applicability(c, p) === 'mandatory' && !seen.has(c.id)) err(`worksheet ${c.id}`, `Mandatory at tier ${p.riskTier}: give a result for "${c.title}".`);
    }
    findings.forEach((f, i) => {
      if (/^fixed/i.test(f.status || '')) return;
      const at = `findings[${i}] ${f.id || ''}`.trim();
      need(f.title, at, 'Give the problem a plain-language title.');
      need(f.fix, at, 'Say what would fix it.');
      need(f.who, at, 'Say who fixes it (a name or a role).');
      if (['Critical', 'High'].includes(f.severity)) need(f.doneWhen, at, 'Say how anyone can tell it is fixed (a test, a check, a result).');
    });

    if (DECISIONS.includes(v.decision)) {
      const { ceiling, reasons } = verdictCeiling(pack, catalogue);
      if (DECISIONS.indexOf(v.decision) < DECISIONS.indexOf(ceiling)) {
        err('verdict.decision', `The worksheet allows at most ${ceiling}: ${reasons.slice(0, 5).join('; ')}${reasons.length > 5 ? '; …' : ''}.`);
      }
      if (v.decision === 'GO WITH CONDITIONS') {
        const referenced = new Set([...(v.blockers || []), ...(v.conditions || [])].flatMap((b) => b.refs || []));
        for (const r of pack.worksheet || []) {
          const c = known.get(r.id);
          if (c && r.result === 'cannot-verify' && applicability(c, p) === 'mandatory' && !referenced.has(r.id)) {
            err('verdict.conditions', `${r.id} could not be verified: list it as a condition.`);
          }
        }
      }
    }
  }
  return problems;
}

// ---------- rendering ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
// Plain text with `code` and **bold**; everything else escaped.
const fmt = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
const list = (items, cls = '') => (items && items.length ? `<ul class="${cls}">${items.map((x) => `<li>${fmt(x)}</li>`).join('')}</ul>` : '');
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

function image(baseDir, path) {
  const file = resolve(baseDir, path);
  const mime = MIME[extname(file).toLowerCase()];
  if (!mime || !existsSync(file)) return null;
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`;
}

function evidenceList(items, baseDir, { thumbs = false } = {}) {
  if (!items || !items.length) return '';
  return `<div class="evidence${thumbs ? ' thumbs' : ''}">${items.map((e) => {
    const src = e.path && image(baseDir, e.path);
    if (src) {
      return `<figure><button type="button" class="zoom" aria-label="Enlarge: ${esc(e.caption || e.path)}"><img src="${src}" alt="${esc(e.caption || e.path)}" loading="lazy"></button>${e.caption ? `<figcaption>${fmt(e.caption)}</figcaption>` : ''}</figure>`;
    }
    const label = e.caption || e.path || e.url;
    const target = e.url ? `<a href="${esc(e.url)}">${fmt(label)}</a>` : fmt(label);
    return `<p class="ev-file">${target}${e.path && e.caption ? ` <code>${esc(e.path)}</code>` : ''}</p>`;
  }).join('')}</div>`;
}

const chip = (result) => `<span class="chip r-${result || 'missing'}">${esc(RESULTS[result] || 'No result')}</span>`;
const sevChip = (sev) => (sev ? `<span class="sev s-${esc(sev.toLowerCase())}">${esc(sev)}</span>` : '');
const GRADE_WORDS = { A: 'the reviewer ran or measured it', B: 'the reviewer inspected it', C: 'a statement only' };
export const TIER_TEXT = {
  1: 'Low risk: an internal tool or prototype, no personal data, no money. Most problems can be fixed after launch.',
  2: 'Standard risk: real users with accounts or personal data, or payments through a hosted checkout. Critical problems block launch; High ones block unless the owner accepts them in writing.',
  3: 'High risk: the app takes payments itself, holds sensitive data, or launches with a big rush. Every Critical or High problem blocks launch, and backups, alerts and an on-call person must be shown.',
};
function table(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

const codeLink = (r) => `<a class="fref" href="#${/^[A-Z]-\d\d$/.test(r) ? 'c-' : 'f-'}${esc(r)}">${esc(r)}</a>`;

function areaCounts(pack, catalogue, code) {
  const rows = new Map((pack.worksheet || []).map((r) => [r.id, r]));
  const counts = { meets: 0, 'does-not-meet': 0, 'cannot-verify': 0, 'not-applicable': 0, missing: 0 };
  for (const c of catalogue.criteria.filter((x) => x.id.startsWith(code + '-'))) {
    const app = applicability(c, pack.project);
    const row = rows.get(c.id);
    if (row?.result) counts[row.result]++;
    else if (app === 'mandatory') counts.missing++;
    else if (app === 'off') counts['not-applicable']++;
  }
  return counts;
}
const countsText = (n) => `${n.meets} meet · ${n['does-not-meet']} don't · ${n['cannot-verify'] + n.missing} can't be verified${n['not-applicable'] ? ` · ${n['not-applicable']} don't apply` : ''}`;

function criteriaBlock(pack, catalogue, code) {
  const rows = new Map((pack.worksheet || []).map((r) => [r.id, r]));
  const findings = pack.findings || [];
  const cs = catalogue.criteria.filter((c) => c.id.startsWith(code + '-'));
  const attention = [];
  const items = cs.map((c) => {
    const app = applicability(c, pack.project);
    const r = rows.get(c.id) || {};
    const result = r.result || (app === 'off' ? 'not-applicable' : app === 'mandatory' ? 'missing' : 'optional');
    const sev = r.result === 'does-not-meet' ? severityOf(r, findings) : null;
    if (['does-not-meet', 'cannot-verify', 'missing'].includes(result)) {
      const what = r.result === 'cannot-verify' ? (r.needed ? `Needed: ${fmt(r.needed)}` : '') : r.finding ? '' : r.fix ? `Fix: ${fmt(r.fix)}` : '';
      const failing = (c.checks || []).filter((q) => r.answers && (r.answers[q.id] === 'no' || r.answers[q.id] === 'unknown')).map((q) => `${esc(q.q)} ${answerChip(r.answers[q.id])}`);
      attention.push(`<li><span class="att-head"><a class="fref" href="#c-${esc(c.id)}">${esc(c.id)}</a> ${esc(c.title)} ${result === 'missing' ? '<span class="chip r-missing">No result</span>' : chip(result)}${sevChip(sev)}${r.finding ? ` ${codeLink(r.finding)}` : ''}</span>${failing.length ? `<span class="att-what">${failing.join('<br>')}</span>` : ''}${what ? `<span class="att-what">${what}</span>` : ''}</li>`);
    }
    const tag = app === 'recommended' ? `<span class="tag">Recommended; required from tier ${c.tier}</span>` : app === 'off' ? '<span class="tag">Doesn\'t apply to this product</span>' : '';
    const notes = [
      r.evidence ? `<p><span class="lbl">Found</span> ${fmt(r.evidence)}</p>` : '',
      r.fix ? `<p><span class="lbl">Fix</span> ${fmt(r.fix)}</p>` : '',
      r.note ? `<p><span class="lbl">Note</span> ${fmt(r.note)}</p>` : '',
      r.needed ? `<p><span class="lbl">Needed to verify</span> ${fmt(r.needed)}</p>` : '',
      r.owner || r.due ? `<p><span class="lbl">Who</span> ${fmt(r.owner || 'not assigned')} · due ${fmt(r.due || 'not set')}</p>` : '',
      r.accepted ? `<p><span class="lbl">Risk accepted</span> by ${fmt(r.accepted.by)} until ${fmt(r.accepted.until)}</p>` : '',
      !r.result && app === 'off' ? `<p class="dim">Applies only to products that ${esc(c.when.map((w) => catalogue.features[w]).join(' or '))}.</p>` : '',
    ].join('');
    const status = r.result ? chip(r.result) : `<span class="chip r-${result}">${result === 'missing' ? 'No result' : result === 'optional' ? 'Not assessed' : 'Not applicable'}</span>`;
    const qList = (c.checks || []).length && (r.answers || app === 'mandatory') ? `<ol class="qlist">${c.checks.map((q) => `<li>${esc(q.q)} ${answerChip(r.answers?.[q.id] || 'missing')}${r.answers?.[q.id] === 'no' ? ` <span class="dim">a no is ${esc(q.ifNo)}</span>` : ''}</li>`).join('')}</ol>` : '';
    return `<li class="crit row-${result}" id="c-${esc(c.id)}">
      <div class="crit-id">${esc(c.id)}</div>
      <div class="crit-body"><p class="crit-title">${esc(c.title)} ${tag}</p>
        <p class="crit-std">${fmt(c.standard)}</p>${qList}${notes}</div>
      <div class="crit-result">${status}${r.grade ? `<span class="grade" title="${esc(GRADE_WORDS[r.grade] || '')}">Evidence ${esc(r.grade)}: ${esc(GRADE_WORDS[r.grade] || '')}</span>` : ''}${sevChip(sev)}${r.finding ? codeLink(r.finding) : ''}</div>
    </li>`;
  });
  const n = areaCounts(pack, catalogue, code);
  const pts = checklistPoints(pack, catalogue).areas.find((a) => a.code === code);
  return `<div class="judged">
    ${pts && pts.total ? `<p class="points"><span class="lbl">Points</span> <b>${pts.yes}</b> of ${pts.total}: one for each question answered yes</p>` : ''}
    ${attention.length ? `<h3>Checklist items that need attention</h3><ul class="attention">${attention.join('')}</ul>` : '<p class="dim">Every checklist item in this area that applies is met.</p>'}
    <details><summary>Full checklist for this area: ${cs.length} items · ${countsText(n)}</summary><ul class="crits">${items.join('')}</ul></details>
  </div>`;
}

function scoreboard(pack, catalogue) {
  const pts = checklistPoints(pack, catalogue);
  return `<p class="points"><span class="lbl">Checklist points</span> <b>${pts.yes}</b> of ${pts.total}: one for each yes/no question answered yes</p><div class="score">${catalogue.areas.map((a) => {
    const ap = pts.areas.find((x) => x.code === a.code);
    const n = areaCounts(pack, catalogue, a.code);
    const total = Object.values(n).reduce((x, y) => x + y, 0) || 1;
    const seg = (k, label) => (n[k] ? `<span class="seg k-${k}" style="flex-grow:${n[k]}" title="${n[k]} ${label}"></span>` : '');
    return `<a class="score-row" href="#${a.section}">
      <span class="score-name">${esc(a.name)}</span>
      <span class="bar" role="img" aria-label="${countsText(n)}, ${n['not-applicable']} don't apply, out of ${total}">${seg('meets', 'meet')}${seg('does-not-meet', "don't meet")}${seg('cannot-verify', "can't be verified")}${seg('missing', 'without a result')}${seg('not-applicable', "don't apply")}</span>
      <span class="score-n"><b class="t-meets">${n.meets}</b> meet · <b class="t-fails">${n['does-not-meet']}</b> don't · <b class="t-unknown">${n['cannot-verify'] + n.missing}</b> can't verify${ap && ap.total ? ` · ${ap.yes}/${ap.total} points` : ''}</span>
    </a>`;
  }).join('')}<p class="legend"><span><i class="k-meets"></i>Meets</span><span><i class="k-does-not-meet"></i>Does not meet</span><span><i class="k-cannot-verify"></i>Cannot be verified</span><span><i class="k-not-applicable"></i>Doesn't apply</span></p></div>`;
}

// Explain each glossary term where it first appears in a section: a dotted underline, with the meaning on hover or tap.
function withGlossary(html, glossary) {
  const terms = (glossary || []).flatMap((g) => {
    const plain = String(g.meaning).replace(/[`*]/g, '');
    const main = g.term.replace(/\s*\(.*\)\s*$/, '');
    const alias = (g.term.match(/\(([^)]+)\)/) || [])[1];
    return [main, alias].filter((t) => t && t.length > 2).map((t) => ({ t, plain }));
  }).sort((a, b) => b.t.length - a.t.length);
  if (!terms.length) return html;
  const used = new Set();
  const skip = /^<(?:(?:code|pre|a|abbr|h[1-6]|summary|th|dt|button|figcaption)(?=[\s>])|span class="(?:chip|sev|lbl|grade|tag|fref|crit-id|pill|oref))/i;
  let depth = 0;
  return html.split(/(<[^>]+>)/).map((tok) => {
    if (tok.startsWith('<')) {
      if (/^<\//.test(tok)) { if (depth > 0) depth--; }
      else if (depth > 0 && !/\/>$/.test(tok) && !/^<(br|img|input|i )/i.test(tok)) depth++;
      else if (skip.test(tok)) depth = 1;
      return tok;
    }
    if (depth > 0 || !tok.trim()) return tok;
    let out = tok;
    for (const { t, plain } of terms) {
      if (used.has(t.toLowerCase())) continue;
      const re = new RegExp(`(^|[^\\w-])(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\w-])`, 'i');
      const m = out.match(re);
      if (!m) continue;
      used.add(t.toLowerCase());
      const i = m.index + m[1].length;
      out = `${out.slice(0, i)}<abbr title="${esc(plain)}" tabindex="0">${m[2]}</abbr>${out.slice(i + m[2].length)}`;
      break; // one term per text run keeps the markup simple; later runs pick up the rest
    }
    return out;
  }).join('');
}

const SECTION_LABELS = {
  verdict: 'Summary', method: 'How it was done', questions: 'Results', recommendations: 'Recommendations', findings: 'What to fix',
  product: 'Product', demo: 'Demo', run: 'How to run it', requirements: 'Requirements', architecture: 'Architecture', rules: 'Business rules',
  harness: 'Harness', performance: 'Performance', security: 'Security', operations: 'Operations', history: 'Quality history',
  acceptance: 'Acceptance', limits: 'Not checked', glossary: 'Glossary',
};
// A finished review reads like an inspection report: evidence and conclusions first, then how they were reached, the
// results for the three questions, the recommendations, and the evidence behind them. A hand-in leads with the product.
export const SECTION_ORDER = {
  review: ['verdict', 'method', 'questions', 'recommendations', 'findings', 'harness', 'performance', 'architecture', 'rules', 'security', 'operations', 'history', 'product', 'demo', 'run', 'requirements', 'acceptance', 'limits', 'glossary'],
  submission: ['verdict', 'findings', 'product', 'demo', 'run', 'requirements', 'architecture', 'rules', 'harness', 'performance', 'security', 'operations', 'history', 'acceptance', 'limits', 'glossary'],
};
const ANSWER_WORDS = { yes: 'Yes', no: 'No', unknown: 'Not known', 'n/a': "Doesn't apply", missing: 'No answer' };
const answerChip = (a) => `<span class="chip ${a === 'yes' ? 'r-meets' : a === 'no' ? 'r-does-not-meet' : a === 'n/a' ? 'r-not-applicable' : 'r-cannot-verify'}">${esc(ANSWER_WORDS[a] || 'No answer')}</span>`;
const ansChip = (a) => `<span class="chip ans ${a === 'Yes' ? 'r-meets' : a === 'No' ? 'r-does-not-meet' : a === 'Partly' ? 'r-cannot-verify' : 'r-not-applicable'}">${esc(a)}</span>`;
const perfChip = (r) => `<span class="chip ${r === 'pass' ? 'r-meets' : r === 'fail' ? 'r-does-not-meet' : 'r-cannot-verify'}">${esc(PERF_RESULTS[r] || 'No result')}</span>`;
const hiddenChip = (r) => `<span class="chip ${r === 'none-found' ? 'r-meets' : r === 'found' ? 'r-does-not-meet' : 'r-cannot-verify'}">${esc(HIDDEN_RESULTS[r] || 'No result')}</span>`;
const skillLink = (t) => (/^https?:/.test(t.link) ? `<a href="${esc(t.link)}">${esc(t.name)}</a>` : `<code>${esc(t.name)}</code>`);

export function renderPage(pack, { baseDir = '.', fragment = false, catalogue = loadCatalogue() } = {}) {
  pack = resolvePack(pack, catalogue);
  const stage = pack.stage || 'submission';
  const problems = validatePack(pack, catalogue, { stage });
  const errors = problems.filter((x) => x.level === 'error');
  const p = pack.project || {};
  const v = pack.verdict || {};
  const reviewed = stage === 'review';
  const decision = reviewed && DECISIONS.includes(v.decision) ? v.decision : null;
  const dClass = decision === 'GO' ? 'go' : decision === 'NO-GO' ? 'nogo' : decision ? 'cond' : 'wait';
  const area = (code) => catalogue.areas.find((a) => a.code === code);
  const glossary = pack.glossary || [];
  const sec = (id, num, title, body, code) => {
    const html = `<section id="${id}"><header class="sec-head"><span class="sec-num">${num}</span><h2>${esc(title)}</h2>${code ? `<p class="sec-q">${esc(area(code).question)}</p>` : ''}</header>${body}${code ? criteriaBlock(pack, catalogue, code) : ''}</section>`;
    return id === 'glossary' ? html : withGlossary(html, glossary);
  };
  const notes = (code) => (pack.areaNotes?.[code] ? `<p class="lede">${fmt(pack.areaNotes[code])}</p>` : '');
  const run = pack.run || {};
  const arch = pack.architecture || {};
  const perf = pack.performance || {};
  const hist = pack.history || {};
  const acc = pack.acceptance || {};
  const findings = pack.findings || [];
  const blockerRefs = new Set((v.blockers || []).flatMap((b) => b.refs || []));
  const conditionWhen = new Map((v.conditions || []).flatMap((c) => (c.refs || []).map((r) => [r, c.when || 'Before launch'])));
  const findingWhen = (f) => (blockerRefs.has(f.id) ? 'Blocks launch' : conditionWhen.has(f.id) ? `Condition: ${conditionWhen.get(f.id)}` : f.when || (f.severity === 'Low' ? 'Can wait until after launch' : 'Agree a date before launch'));
  const refs = (list) => (list && list.length ? ` <span class="refs-inline">details: ${list.map(codeLink).join(' ')}</span>` : '');

  const todoRows = [
    ...(v.blockers || []).map((b) => ({ ...b, when: 'Before launch', blocker: true })),
    ...(v.conditions || []).map((c) => ({ ...c, when: c.when || 'Before launch' })),
  ];
  const todo = todoRows.length ? `<div class="table-wrap todo-table"><table><thead><tr><th>#</th><th>What has to happen</th><th>Who</th><th>How big</th><th>When</th></tr></thead><tbody>${todoRows.map((t, i) => `<tr class="${t.blocker ? 'is-blocker' : ''}">
      <td class="num">${i + 1}</td>
      <td>${t.blocker ? '<span class="pill pill-block">Blocker</span> ' : '<span class="pill">Condition</span> '}${fmt(t.text)}${t.why ? `<br><span class="dim">${fmt(t.why)}</span>` : ''}${refs(t.refs)}</td>
      <td data-label="Who">${fmt(t.who || 'not assigned')}</td><td data-label="How big">${fmt(t.effort || '—')}</td><td data-label="When">${fmt(t.when)}</td></tr>`).join('')}</tbody></table></div>` : '';

  const ins = reviewed ? inspection(pack, catalogue) : null;
  const said = ins ? conclusions(ins) : null;
  const probItem = (f) => `<li>${codeLink(f.id)} ${sevChip(f.severity)} ${fmt(f.title || '')}</li>`;
  const qEvidence = ins ? {
    harness: `${ins.harness.yes} of ${ins.harness.points} harness questions answered yes${ins.harness.recurring ? `; ${recurringText(ins.harness)}` : ''}.`,
    performance: ins.performance.total ? `${ins.performance.run} of ${ins.performance.total} kinds of performance test run; ${ins.performance.passed} passed, ${ins.performance.failed} failed.` : 'None required at this risk tier.',
    hidden: `${ins.hidden.examined} of ${ins.hidden.total} places examined; ${ins.hidden.found.length} hidden problem${ins.hidden.found.length === 1 ? '' : 's'} found.`,
  } : {};
  const qTable = ins ? `<div class="table-wrap q-table"><table><thead><tr><th>Question</th><th>Answer</th><th>Evidence</th></tr></thead><tbody>${Object.keys(QUESTIONS).map((k, i) => `<tr><td><a href="#q-${k}">${i + 1}. ${esc(QUESTIONS[k].title)}</a></td><td>${ansChip(ins[k].answer)}</td><td>${esc(qEvidence[k])}</td></tr>`).join('')}</tbody></table></div>` : '';

  const summaryBody = `
    ${errors.length ? `<div class="incomplete"><p><strong>This review is incomplete.</strong> ${errors.length} required item${errors.length > 1 ? 's are' : ' is'} missing or inconsistent:</p><ul>${errors.map((e) => `<li><code>${esc(e.where)}</code> ${esc(e.message)}</li>`).join('')}</ul></div>` : ''}
    <div class="verdict-grid">
      <div class="stamp ${dClass}"><span class="stamp-label">Verdict</span><span class="stamp-text">${esc(decision || 'Not given')}</span><span class="stamp-meta">Risk tier ${esc(p.riskTier)} of 3</span></div>
      <div class="verdict-text">${v.reason ? `<p class="reason">${fmt(v.reason)}</p>` : ''}
        ${v.ifLaunchedNow ? `<div class="anyway"><h3>If it were delivered or launched now</h3><p>${fmt(v.ifLaunchedNow)}</p></div>` : ''}
      </div>
    </div>
    <h3>The three questions</h3><p class="dim">${esc(QUESTIONS_NOTE)}</p>${qTable}
    ${ins ? `<ul class="said">${Object.keys(QUESTIONS).map((k) => `<li>${esc(said[k])}</li>`).join('')}</ul>` : ''}
    ${(v.blockers || []).length ? `<h3>Before delivery: ${v.blockers.length} blocker${v.blockers.length === 1 ? '' : 's'}</h3><ol class="top">${v.blockers.map((b) => `<li>${fmt(b.text)}</li>`).join('')}</ol><p class="dim">Who does each, how big it is, and the conditions: <a href="#recommendations">Recommendations</a>.</p>` : ''}
    ${v.estimate ? `<p class="estimate"><span class="lbl">When it could be delivered</span> ${fmt(v.estimate)}</p>` : ''}
    <p class="signoff">${v.signedBy ? `Signed by <strong>${fmt(v.signedBy)}</strong> on ${fmt(v.signedOn)} for version <code>${esc(p.commit)}</code>.` : `Not signed yet. ${fmt(v.signer || 'The product owner')} signs here, with name, date and the version inspected (<code>${esc(p.commit || '…')}</code>).`}</p>`;

  const sources = methodSources(pack, catalogue);
  const usedN = sources.filter((x) => x.entry?.used).length;
  const methodBody = `
    <p class="lede">Version <code>${esc(p.commit || '—')}</code>${p.repository ? ` of ${fmt(p.repository)}` : ''}${p.versionNote ? ` (${fmt(p.versionNote)})` : ''}, inspected ${esc(p.reviewedOn || '—')} by ${fmt(p.reviewer || '—')}, at risk tier ${esc(p.riskTier)}: ${esc(TIER_TEXT[p.riskTier] || '')}</p>
    <h3>Sources of evidence (${usedN} of ${sources.length} used)</h3>
    ${table(['Source', 'Used', 'What was used, or why not', 'Why it matters'], sources.map((x) => [esc(x.name), x.entry ? `<span class="chip ${x.entry.used ? 'r-meets' : 'r-not-applicable'}">${x.entry.used ? 'Used' : 'Not used'}</span>` : '<span class="chip r-missing">No entry</span>', fmt(x.entry?.detail || ''), esc(x.why)]))}
    ${filled(pack.method?.skills) ? `<h3>Skills and tools used</h3>${table(['Skill or tool', 'What it did'], pack.method.skills.map((x) => [fmt(x.name), fmt(x.how || '')]))}` : ''}
    <div class="key"><h3>How to read the results</h3><dl>
      <dt>Questions and points</dt><dd>Every checklist item is a few yes/no questions, each about one fact the inspector could see or run. Each yes is a point. The software works out the item's result from the answers (any no: doesn't meet; any not known: can't verify) and its severity from the most serious no, so two inspections that agree on the facts get the same results.</dd>
      <dt>Yes, Partly, No</dt><dd>Counted by software from the record: everything done is Yes, at least half is Partly, less than half is No.</dd>
      <dt>Blocker</dt><dd>Delivery can't happen until it's done.</dd>
      <dt>Condition</dt><dd>Also required, at the time shown, but not a reason to stop on its own.</dd>
      <dt>Cannot verify</dt><dd>The inspector didn't have what was needed to check it. It is not a pass: each one says what's needed.</dd>
      <dt>Codes</dt><dd>Codes like ARC-11 are problems found (see <a href="#findings">What to fix</a>). Codes like A-09 are checklist items, under "Full checklist" in each evidence section.</dd>
      <dt>Evidence A, B, C</dt><dd>A: the inspector ran or measured it. B: the inspector read the code or settings. C: someone's statement, which never counts as proof.</dd>
      <dt>Dotted underline</dt><dd>Hover over it, or tap it, for an explanation.</dd>
    </dl></div>`;

  const qCard = (n, key, evidence, recommendation, more) => `<article class="q" id="q-${key}">
      <header><span class="q-num">${n}</span><h3>${esc(QUESTIONS[key].title)}</h3>${ansChip(ins[key].answer)}</header>
      <p class="dim">${esc(QUESTIONS[key].why)}</p>
      <h4>Evidence</h4>${evidence}
      <h4>Conclusion</h4><p class="conclusion">${esc(said[key])}</p>
      ${recommendation ? `<h4>Recommendation</h4>${recommendation}` : ''}
      <p class="q-more"><a href="#${more}">All the evidence: ${esc(SECTION_LABELS[more])}</a></p>
    </article>`;
  const hz = ins?.harness, pf = ins?.performance, hd = ins?.hidden;
  const questionsBody = ins ? `<p class="dim">${esc(QUESTIONS_NOTE)}</p><div class="qs">
    ${qCard(1, 'harness', `<p>${hz.yes} of ${hz.points} harness questions answered yes; ${hz.met} of ${hz.total} checks fully met.</p>
      <div class="q-cols"><div><h5>In place</h5>${hz.met ? `<ul>${hz.checks.filter((x) => x.result === 'meets').map((x) => `<li>${codeLink(x.id)} ${esc(x.title)}</li>`).join('')}</ul>` : '<p class="dim">None.</p>'}</div>
      <div><h5>Answered no, or not known</h5>${hz.questions.some((x) => x.answer !== 'yes' && x.answer !== 'n/a') ? `<ul>${hz.questions.filter((x) => x.answer !== 'yes' && x.answer !== 'n/a').map((x) => `<li>${codeLink(x.criterion)} ${esc(x.q)} ${answerChip(x.answer)}</li>`).join('')}</ul>` : '<p class="dim">Nothing.</p>'}</div></div>
      ${hz.recurring ? `<p>${hz.recurring} kinds of problem came back during the project (see <a href="#history">Quality history</a>): ${esc(recurringText(hz).replace(/^of the \d+ kinds of problem that came back, /, ''))}. The kind of test that would catch each:</p>
      ${table(['Kind of test', 'In the project', 'Would catch these problems that came back'], hz.testKinds.filter((k) => k.suites.length || k.needed.length).map((k) => [esc(k.name), k.suites.length ? `Yes: ${esc(k.suites.join(', '))}` : '<strong>No</strong>', k.needed.length ? k.needed.map((n) => `${esc(n.name)} <span class="dim">(${n.times} time${n.times === 1 ? '' : 's'}${n.caught ? ', caught now' : ''})</span>`).join('<br>') : '<span class="dim">none</span>']))}` : ''}`,
      hz.recommend.length ? `<p>Most needed first:</p><ol class="recs">${hz.recommend.map((k) => { const t = recommendText(k); return `<li><strong>${esc(t.what)}</strong> ${esc(t.forWhat)}<br><span class="dim">${esc(t.catches)}${k.skills.length ? ` Skills and tools: ${k.skills.map(skillLink).join(', ')}.` : ''}</span></li>`; }).join('')}</ol>` : '', 'harness')}
    ${qCard(2, 'performance', table(['Kind of test', 'Result', 'What it showed'], pf.kinds.map((k) => [`${esc(k.name)}${k.mandatory ? '' : ' <span class="tag">recommended</span>'}`, perfChip(k.result), `${fmt(k.note)}${k.by ? ` <span class="dim">(run by the ${esc(k.by)})</span>` : ''}`])),
      pf.run < pf.total ? `<p>Run these tests:</p><ul class="recs">${pf.kinds.filter((k) => k.mandatory && !(k.result === 'pass' || k.result === 'fail')).map((k) => `<li><strong>${esc(k.name)}.</strong> ${esc(k.proves)}</li>`).join('')}</ul>${(catalogue.toolbox || []).some((t) => t.kinds.includes('load')) ? `<p class="dim">Skills: ${(catalogue.toolbox || []).filter((t) => t.kinds.includes('load')).map(skillLink).join(', ')} runs the load, beyond-capacity, rush and slow-partner tests; Lighthouse measures page speed on phones.</p>` : ''}` : '', 'performance')}
    ${qCard(3, 'hidden', `${table(['Where hidden problems sit', 'Result', 'Problems'], hd.areas.map((a) => [esc(a.name), hiddenChip(a.result), a.refs.map(codeLink).join(' ')]))}
      ${hd.found.length ? `<h5>The ${hd.found.length} hidden problem${hd.found.length === 1 ? '' : 's'}, most serious first</h5><ul class="probs">${hd.found.map(probItem).join('')}</ul>` : ''}`,
      `${hd.examined < hd.total ? `<ul class="recs">${hd.areas.filter((a) => !(a.result === 'found' || a.result === 'none-found')).map((a) => `<li><strong>Examine ${esc(a.name.toLowerCase())}.</strong> ${esc(a.look)}</li>`).join('')}</ul>` : ''}${hd.found.length ? `<p>Fix the hidden problems (see <a href="#findings">What to fix</a>), and for each add the test that would have caught it, so it can't come back unnoticed.</p>` : ''}`, 'architecture')}
    </div>
    <h3>Results by area</h3>${scoreboard(pack, catalogue)}` : '';

  const recommendationsBody = `
    ${todo ? `<h3>What has to happen</h3>${todo}` : '<p class="dim">Nothing has to happen before delivery.</p>'}
    ${hz && hz.recommend.length ? `<h3>Strengthen the test harness</h3><p>So the problems that came back can't come back again unnoticed. Most needed first:</p><ol class="recs">${hz.recommend.map((k) => { const t = recommendText(k); return `<li><strong>${esc(t.what)}</strong> ${esc(t.forWhat)}${k.skills.length ? ` <span class="dim">Skills and tools: ${k.skills.map(skillLink).join(', ')}.</span>` : ''}</li>`; }).join('')}</ol>` : ''}
    ${filled(catalogue.toolbox) ? `<h3>Skills and tools the team can use</h3><p class="dim">Install them in Claude Code so the AI agents that write the code also write and run these tests.</p>${table(['Skill or tool', 'From', 'Helps build', 'What it does'], catalogue.toolbox.map((t) => [skillLink(t), esc(t.from), esc(t.kinds.map((k) => (catalogue.testKinds.find((x) => x.id === k) || { name: k }).name.toLowerCase()).join(', ') || '—'), esc(t.what)]))}` : ''}
    ${filled(v.decisions) ? `<div class="decide"><h3>Decisions only the owner can make</h3><ul>${v.decisions.map((d) => `<li>${fmt(d.text)}${refs(d.refs)}</li>`).join('')}</ul></div>` : ''}
    ${filled(v.noticeable) ? `<h3>What customers would notice today</h3>${list(v.noticeable)}` : ''}`;

  const verdictBody = reviewed ? summaryBody : `
    ${errors.length ? `<div class="incomplete"><p><strong>${reviewed ? 'This review is incomplete' : 'This submission is not reviewable yet'}.</strong> ${errors.length} required item${errors.length > 1 ? 's are' : ' is'} missing or inconsistent:</p><ul>${errors.map((e) => `<li><code>${esc(e.where)}</code> ${esc(e.message)}</li>`).join('')}</ul></div>` : ''}
    <div class="verdict-grid">
      <div class="stamp ${dClass}"><span class="stamp-label">${reviewed ? 'Verdict' : 'Status'}</span><span class="stamp-text">${esc(decision || 'Awaiting review')}</span><span class="stamp-meta">Risk tier ${esc(p.riskTier)} of 3</span></div>
      <div class="verdict-text">${reviewed && v.reason ? `<p class="reason">${fmt(v.reason)}</p>` : `<p class="reason">Submitted by ${fmt(String(p.author || '').replace(/\.$/, ''))} for review. The verdict, results and findings are filled in by the reviewer.</p>`}
        ${v.ifLaunchedNow ? `<div class="anyway"><h3>If you launched anyway</h3><p>${fmt(v.ifLaunchedNow)}</p></div>` : ''}
      </div>
    </div>
    ${todo ? `<h3>What has to happen</h3>${todo}` : ''}
    ${filled(v.decisions) ? `<div class="decide"><h3>Decisions only you can make</h3><ul>${v.decisions.map((d) => `<li>${fmt(d.text)}${refs(d.refs)}</li>`).join('')}</ul></div>` : ''}
    ${v.estimate ? `<p class="estimate"><span class="lbl">When you could launch</span> ${fmt(v.estimate)}</p>` : ''}
    ${filled(v.noticeable) ? `<h3>What customers would notice today</h3>${list(v.noticeable)}` : ''}
    <div class="key"><h3>How to read this page</h3><dl>
      <dt>Product owner</dt><dd>You: the person this review is for, who decides whether to launch and signs.</dd>
      <dt>Blocker</dt><dd>Launch can't happen until it's done.</dd>
      <dt>Condition</dt><dd>Also required, at the time shown, but not a reason to stop launch on its own.</dd>
      <dt>Cannot verify</dt><dd>The reviewer didn't have what was needed to check it. It is not a pass: each one says what's needed.</dd>
      <dt>Risk tier ${esc(p.riskTier)}</dt><dd>${esc(TIER_TEXT[p.riskTier] || '')}</dd>
      <dt>Codes</dt><dd>Codes like ARC-11 or OPS-08 are problems found (see <a href="#findings">What to fix</a>). Codes like A-09 or O-03 are checklist items (under "Full checklist" in each section).</dd>
      <dt>Evidence A, B, C</dt><dd>A: the reviewer ran or measured it. B: the reviewer inspected the code or settings. C: someone's statement, which never counts as proof.</dd>
      <dt>Dotted underline</dt><dd>Hover over it, or tap it, for an explanation.</dd>
    </dl></div>
    <h3>Results by area</h3>${scoreboard(pack, catalogue)}
    <p class="signoff">${v.signedBy ? `Signed by <strong>${fmt(v.signedBy)}</strong> on ${fmt(v.signedOn)} for version <code>${esc(p.commit)}</code>.` : `Not signed yet. ${fmt(v.signer || 'The product owner')} signs here, with name, date and the version reviewed (<code>${esc(p.commit || '…')}</code>).`}</p>
    <p class="details-line">Review details: version <code>${esc(p.commit || '—')}</code>${p.repository ? ` of ${fmt(p.repository)}` : ''}${p.versionNote ? ` (${fmt(p.versionNote)})` : ''} · submitted ${esc(p.date || '—')} by ${fmt(p.author || '—')}${reviewed ? ` · reviewed ${esc(p.reviewedOn || '—')} by ${fmt(p.reviewer || '—')}` : ''}.</p>`;

  const sevOrder = (f) => (blockerRefs.has(f.id) ? 0 : 1) * 10 + Math.max(0, ['Critical', 'High', 'Medium', 'Low'].indexOf(f.severity));
  const open = findings.filter((f) => !/^fixed/i.test(f.status || '')).sort((a, b) => sevOrder(a) - sevOrder(b));
  const done = findings.filter((f) => /^fixed/i.test(f.status || ''));
  const findingsBody = findings.length ? `
    <p class="lede">${open.length} open problem${open.length === 1 ? '' : 's'}, blockers first, then by severity.${done.length ? ` ${done.length} more already fixed and verified are listed at the end.` : ''}</p>
    <ul class="findings">${open.map((f) => `<li id="f-${esc(f.id)}" class="finding${blockerRefs.has(f.id) ? ' is-blocker' : ''}">
      <div class="f-head"><span class="crit-id">${esc(f.id)}</span>${sevChip(f.severity)}<span class="pill${blockerRefs.has(f.id) ? ' pill-block' : ''}">${esc(findingWhen(f))}</span><span class="f-status">${fmt(f.status || 'Open')}${f.confidence ? ` · ${fmt(f.confidence)}` : ''}</span></div>
      <p class="f-title">${fmt(f.title)}</p>
      <dl class="f-grid">
        ${f.impact ? `<dt>Impact</dt><dd>${fmt(f.impact)}</dd>` : ''}
        ${f.who ? `<dt>Who</dt><dd>${fmt(f.who)}</dd>` : ''}
        ${f.where ? `<dt>Where</dt><dd>${fmt(f.where)}</dd>` : ''}
        ${f.evidence ? `<dt>Evidence</dt><dd>${fmt(f.evidence)}</dd>` : ''}
        ${f.fix ? `<dt>Fix</dt><dd>${fmt(f.fix)}</dd>` : ''}
        ${f.doneWhen ? `<dt>Done when</dt><dd>${fmt(f.doneWhen)}</dd>` : ''}
        ${filled(f.dependsOn) ? `<dt>Depends on</dt><dd>${f.dependsOn.map((x) => (/^[A-Z]+-\d+$/.test(x) ? codeLink(x) : fmt(x))).join(' · ')}</dd>` : ''}
      </dl>
    </li>`).join('')}</ul>
    ${done.length ? `<h3>Already fixed and verified</h3><ul class="done">${done.map((f) => `<li id="f-${esc(f.id)}"><span class="crit-id">${esc(f.id)}</span> ${fmt(f.title)} <span class="dim">${fmt(f.status)}</span></li>`).join('')}</ul>` : ''}` : '<p class="dim">No problems recorded.</p>';

  const productBody = `<p class="lede">${fmt(p.summary)}</p>
    ${pack.product?.users ? `<p><span class="lbl">Users</span> ${fmt(pack.product.users)}</p>` : ''}
    ${filled(pack.product?.outOfScope) ? `<h3>Out of scope</h3>${list(pack.product.outOfScope)}` : ''}
    <p><span class="lbl">Risk tier ${esc(p.riskTier)}</span> ${fmt(p.riskReason ? p.riskReason.charAt(0).toUpperCase() + p.riskReason.slice(1) : '')} <span class="dim">${esc(TIER_TEXT[p.riskTier] || '')}</span></p>
    ${filled(p.features) ? `<p class="feats">${p.features.map((f) => `<span class="feat">${esc(catalogue.features[f] || f)}</span>`).join('')}</p>` : ''}`;

  const demoBody = `<div class="journeys">${(pack.product?.journeys || []).map((j) => `<article class="journey" id="j-${esc(j.id || '')}">
      <h3>${j.id ? `<span class="jid">${esc(j.id)}</span> ` : ''}${esc(j.name)}</h3>${j.who ? `<p class="dim">${fmt(j.who)}</p>` : ''}
      <ol class="steps">${(j.steps || []).map((s) => `<li>${fmt(s)}</li>`).join('')}</ol>
      <p><span class="lbl">Expected</span> ${fmt(j.expected)}</p>
      ${j.actual ? `<p class="${j.actual.trim().toLowerCase().startsWith('as expected') ? '' : 'actual-diff'}"><span class="lbl">What happened</span> ${fmt(j.actual)}</p>` : ''}
      ${evidenceList(j.evidence, baseDir)}
      ${filled(j.criteria) ? `<p class="refs">Proved by acceptance criteria ${j.criteria.map((c) => `<a class="fref" href="#a-${esc(c)}">${esc(c)}</a>`).join(' ')}</p>` : ''}
    </article>`).join('')}</div>`;

  const runBody = `<p class="dim">For whoever runs the app: usually the developer.</p>${filled(run.prerequisites) ? `<h3>Prerequisites</h3>${list(run.prerequisites)}` : ''}
    <h3>Commands</h3>
    <div class="cmds">${[['Set up', run.setup], ['Start', run.start], ['Open', run.open], ['Test', run.test], ['Reset test data', run.reset]]
      .filter(([, c]) => filled(c)).map(([k, c]) => `<div class="cmd"><span class="lbl">${k}</span>${(Array.isArray(c) ? c : [c]).map((x) => `<pre><code>${esc(x)}</code></pre>`).join('')}</div>`).join('')}</div>
    ${run.staging !== undefined ? `<p><span class="lbl">Test copy (staging)</span> ${run.staging ? fmt(run.staging) : '<span class="dim">None provided.</span>'}</p>` : ''}
    ${filled(run.accounts) ? `<h3>Test accounts</h3>${table(['Role', 'How to sign in'], run.accounts.map((a) => [fmt(a.role), fmt(a.how)]))}` : ''}
    ${filled(run.settings) ? `<h3>Settings (${run.settings.length})</h3>${table(['Setting', 'What it does', 'Secret', 'Needed in production', 'Example'], run.settings.map((s) => [`<code>${esc(s.name)}</code>`, fmt(s.purpose), s.secret ? 'Yes' : 'No', typeof s.production === 'string' ? fmt(s.production) : s.production ? 'Yes' : 'No', s.example ? `<code>${esc(s.example)}</code>` : '']))}` : ''}`;

  const reqBody = filled(pack.requirements) ? table(['ID', 'Requirement', 'Target', 'Agreed by'], pack.requirements.map((r) => [esc(r.id || ''), fmt(r.text), fmt(r.target), `${fmt(r.agreedBy || '—')}${r.agreedOn ? ` <span class="dim">${esc(r.agreedOn)}</span>` : ''}${r.source ? `<br><span class="dim">${fmt(r.source)}</span>` : ''}`])) : '';

  const archBody = `${arch.summary ? `<p class="lede">${fmt(arch.summary)}</p>` : ''}${notes('A')}
    ${arch.diagram ? `<div class="diagram"><pre class="mermaid">${esc(arch.diagram)}</pre></div>` : ''}
    ${filled(arch.components) ? `<h3>Components (${arch.components.length})</h3>${table(['Component', 'Its job', 'Built with'], arch.components.map((c) => [fmt(c.name), fmt(c.job), fmt(c.tech || '')]))}` : ''}
    ${filled(arch.entryPoints) ? `<h3>Entry points (${arch.entryPoints.length})</h3>${table(['Entry point', 'Who may call it', 'What stops everyone else', 'What it touches'], arch.entryPoints.map((e) => [fmt(e.entry), fmt(e.caller), fmt(e.guard || ''), fmt(e.touches || '')]))}` : ''}
    ${filled(arch.dataStores) ? `<h3>Data stores</h3>${table(['Store', 'Holds', 'Sensitivity'], arch.dataStores.map((d) => [fmt(d.name), fmt(d.holds), fmt(d.sensitivity || '')]))}` : ''}
    ${filled(arch.services) ? `<h3>Outside services</h3>${table(['Service', 'Used for', 'Time limit', 'When it fails'], arch.services.map((s) => [fmt(s.name), fmt(s.purpose), fmt(s.timeout || '—'), fmt(s.onFailure || '—')]))}` : ''}
    ${filled(arch.decisions) ? `<h3>Decisions</h3>${table(['Decision', 'Why', 'Alternatives', 'Downsides'], arch.decisions.map((d) => [fmt(d.title), fmt(d.why), fmt(d.alternatives || ''), fmt(d.downsides || '')]))}` : ''}
    ${hd ? `<h3>Where the review looked for hidden problems</h3>${table(['Place', 'What to look for', 'How the review looked', 'Result', 'Problems'], hd.areas.map((a) => [esc(a.name), esc(a.look), fmt(a.how || '—'), hiddenChip(a.result), a.refs.map(codeLink).join(' ')]))}` : ''}`;

  const rulesBody = `${notes('D')}${filled(pack.rules) ? table(['ID', 'Rule', 'Enforced by', 'Proved by'], pack.rules.map((r) => [esc(r.id || ''), `<strong>${fmt(r.rule)}</strong>`, fmt(r.enforcedBy), fmt(r.provenBy || '—')])) : ''}`;

  const h = pack.harness || {};
  const harnessBody = `${notes('H')}
    <p><span class="lbl">Agent instructions</span> ${h.agentFile ? `<code>${esc(h.agentFile.path)}</code> ${fmt(h.agentFile.summary || '')}` : '<span class="dim">None: AI coding assistants get no project-specific instructions.</span>'}</p>
    ${filled(h.suites) ? `<h3>Automated tests</h3>${table(['Suite', 'Type', 'Covers', 'Command', 'Last run', 'Runs automatically on every change'], h.suites.map((s) => [fmt(s.name), `${esc((catalogue.testKinds || []).find((k) => k.id === s.type)?.name || s.type || '—')}${s.kind ? `<br><span class="dim">${fmt(s.kind)}</span>` : ''}`, fmt(s.covers || ''), `<code>${esc(s.command || '')}</code>`, fmt(s.lastRun || '—'), s.inCI ? 'Yes' : 'No']))}` : ''}
    ${filled(h.ci) ? `<h3>Automatic checks on every change (CI)</h3>${list(h.ci)}` : ''}${filled(h.checks) ? `<h3>Other checks</h3>${list(h.checks)}` : ''}`;

  const perfBody = `${notes('P')}
    ${pf ? `<h3>Kinds of performance test</h3>${table(['Kind of test', 'What it proves', 'Run by', 'Result', 'What it showed'], pf.kinds.map((k) => [`${esc(k.name)}${k.mandatory ? '' : ' <span class="tag">recommended</span>'}`, esc(k.proves), esc(k.by || '—'), perfChip(k.result), fmt(k.note)]))}` : ''}
    ${perf.target ? `<p><span class="lbl">Target</span> ${fmt(perf.target)}</p>` : ''}${perf.environment ? `<p><span class="lbl">Tested on</span> ${fmt(perf.environment)}</p>` : ''}
    ${filled(perf.runs) ? `<h3>Load test runs</h3>${table(['Run', 'Result', 'Notes'], perf.runs.map((r) => [fmt(r.label), `<span class="chip ${r.pass ? 'r-meets' : 'r-does-not-meet'}">${esc(r.result)}</span>`, fmt(r.note || '')]))}` : ''}
    ${filled(perf.steps) ? `<h3>${fmt(perf.stepsTitle || 'Per step')}</h3>${table(['Step', 'Request', 'Target', 'Achieved', '95% faster than (budget)', 'Errors', 'Result'], perf.steps.map((s) => [fmt(s.step), fmt(s.endpoint), fmt(s.target), fmt(s.achieved), fmt(s.p95), fmt(s.errors), `<span class="chip ${s.pass ? 'r-meets' : 'r-does-not-meet'}">${s.pass ? 'Pass' : 'Fail'}</span>`]))}` : ''}
    ${perf.race ? `<h3>Race test</h3><p>${fmt(perf.race.summary)}</p>${filled(perf.race.rows) ? table(['Measure', 'Value'], perf.race.rows.map((r) => [fmt(r.measure), `<span class="num">${fmt(r.value)}</span>`])) : ''}` : ''}
    ${perf.slowPartner ? `<h3>Slow partner</h3><p>${fmt(perf.slowPartner)}</p>` : ''}
    ${perf.conclusion ? `<p class="callout">${fmt(perf.conclusion)}</p>` : ''}`;

  const histBody = `${notes('Q')}
    ${hist.period ? `<p><span class="lbl">Period</span> ${fmt(hist.period)}</p>` : ''}${filled(hist.sources) ? `<p><span class="lbl">Sources</span></p>${list(hist.sources)}` : ''}
    ${(() => {
      const classes = hist.classes || [];
      const occ = classes.flatMap((c) => c.occurrences || []);
      const computed = classes.length ? [
        { value: String(classes.length), label: 'Kinds of problem that came back' },
        { value: String(occ.filter((o) => o.byFix).length), label: 'Problems introduced by a fix' },
        { value: `${classes.filter((c) => c.status === 'controlled').length} / ${classes.filter((c) => c.status === 'partly controlled').length} / ${classes.filter((c) => !['controlled', 'partly controlled'].includes(c.status)).length}`, label: 'Kinds caught automatically / partly / not at all' },
        { value: String((hist.known || []).length), label: 'Problems open now' },
      ] : [];
      const all = [...computed, ...(hist.stats || [])];
      return all.length ? `<div class="stats">${all.map((s) => `<div class="stat"><span class="stat-v">${fmt(s.value)}</span><span class="stat-l">${fmt(s.label)}</span></div>`).join('')}</div>` : '';
    })()}
    ${filled(hist.classes) ? `<h3>Problems that came back (${hist.classes.length} kinds)</h3><div class="classes">${hist.classes.map((c) => `<article class="pclass">
        <header><h4>${fmt(c.name)}</h4><span class="chip ${c.status === 'controlled' ? 'r-meets' : c.status === 'partly controlled' ? 'r-cannot-verify' : 'r-does-not-meet'}">${esc({ controlled: 'Caught automatically', 'partly controlled': 'Partly caught automatically', open: 'Not caught automatically' }[c.status] || c.status || 'Not caught automatically')}</span></header>
        <p class="occ-n">Seen ${(c.occurrences || []).length} times</p>
        <ul class="occ">${(c.occurrences || []).map((o) => `<li><span class="oref">${fmt(o.ref)}</span> ${fmt(o.text)}${o.byFix ? ' <span class="pill">Introduced by a fix</span>' : ''}</li>`).join('')}</ul>
        <p><span class="lbl">Why it keeps happening</span> ${fmt(c.rootCause)}</p>
        <p><span class="lbl">What catches the next one</span> ${fmt(c.control)}</p>
        ${filled(c.catchWith) ? `<p><span class="lbl">Kind of test</span> ${esc(c.catchWith.map((k) => (catalogue.testKinds || []).find((x) => x.id === k)?.name || k).join(', '))}</p>` : ''}
        ${c.controlCheck ? `<p><span class="lbl">Checked</span> ${fmt(c.controlCheck)}</p>` : ''}
        ${c.agentRule ? `<p><span class="lbl">Rule for AI agents</span> ${fmt(c.agentRule)}</p>` : ''}
      </article>`).join('')}</div>` : ''}
    ${filled(hist.hotspots) ? `<h3>Hotspots: where problems cluster</h3>${table(['File', 'Fix commits', 'Note'], hist.hotspots.map((x) => [`<code>${esc(x.file)}</code>`, `<span class="num">${esc(x.fixes)}</span>`, fmt(x.note || '')]))}` : ''}
    <h3>Known problems register (${(hist.known || []).length})</h3>${filled(hist.known) ? table(['ID', 'Problem', 'Severity', 'Who', 'Due', 'Status'], hist.known.map((k) => [codeLink(k.id || ''), fmt(k.text), sevChip(k.severity), fmt(k.owner || 'not assigned'), fmt(k.due || 'not set'), fmt(k.status || 'Open')])) : '<p class="dim">No known problems declared.</p>'}`;

  const accBody = `${notes('U')}
    ${acc.criteriaVersion ? `<p><span class="lbl">Criteria</span> version ${fmt(acc.criteriaVersion)}${acc.agreedBy ? `, agreed by ${fmt(acc.agreedBy)}` : ''}${acc.run ? `. ${fmt(acc.run)}` : ''}</p>` : ''}
    ${filled(acc.rows) ? `<ul class="acc">${acc.rows.map((r) => `<li id="a-${esc(r.id)}" class="acc-row">
        <div class="acc-head"><span class="crit-id">${esc(r.id)}</span><span class="prio">${esc(r.priority || '')}</span><span class="acc-c">${fmt(r.criterion)}</span>
        <span class="chip ${r.status === 'pass' ? 'r-meets' : r.status === 'fail' || r.status === 'flaky' ? 'r-does-not-meet' : r.status === 'external' ? 'r-not-applicable' : 'r-cannot-verify'}">${esc({ pass: 'Pass', fail: 'Fail', flaky: 'Flaky', external: 'Checked by another test (see note)', 'not-run': 'Not run' }[r.status] || r.status || 'Not run')}${r.runs ? ` ${esc(r.runs)}` : ''}</span></div>
        ${r.note ? `<p class="dim">${fmt(r.note)}</p>` : ''}${evidenceList(r.evidence, baseDir, { thumbs: true })}</li>`).join('')}</ul>` : ''}`;

  const parts = {
    verdict: [reviewed ? 'Summary: evidence and conclusions' : 'Status', verdictBody],
    method: ['How the inspection was done', methodBody],
    questions: ['Results: the three questions', questionsBody],
    recommendations: ['Recommendations', recommendationsBody],
    findings: [reviewed ? 'What to fix: every open problem' : 'What to fix', findingsBody],
    product: ['Product', productBody],
    demo: ['Demo: the main journeys', demoBody],
    run: ['How to run it', runBody, 'R'],
    requirements: ['Requirements: the agreed standard', reqBody],
    architecture: ['Architecture', archBody, 'A'],
    rules: ['Business rules', rulesBody, 'D'],
    harness: ['Harness: tests, automatic checks and AI-agent instructions', harnessBody, 'H'],
    performance: ['Performance', perfBody, 'P'],
    security: ['Security', `${notes('S')}${filled(pack.scans?.triage) ? `<h3>Automated scans: what each hit became (${pack.scans.triage.length})</h3>${table(['Tool', 'Rule', 'Where', 'Outcome'], pack.scans.triage.map((t) => [fmt(t.tool), `<code>${esc(t.rule)}</code>`, fmt(t.where || ''), t.outcome === 'reported' ? `Reported as ${codeLink(t.ref)}` : `Not a problem here: ${fmt(t.reason || '')}`]))}` : ''}`, 'S'],
    operations: ['Operations', notes('O'), 'O'],
    history: ['Quality history: problems that keep coming back', histBody, 'Q'],
    acceptance: ['Acceptance', accBody, 'U'],
    limits: ['Not checked', filled(pack.notChecked) ? list(pack.notChecked) : '<p class="dim">Nothing listed.</p>'],
    glossary: ['Glossary', filled(glossary) ? `<dl class="gloss">${glossary.map((g) => `<dt>${fmt(g.term)}</dt><dd>${fmt(g.meaning)}</dd>`).join('')}</dl>` : '<p class="dim">No terms listed.</p>'],
  };
  const order = SECTION_ORDER[reviewed ? 'review' : 'submission'];
  const body = order.map((id, i) => sec(id, i + 1, parts[id][0], parts[id][1], parts[id][2])).join('\n');
  const num = (id) => order.indexOf(id) + 1;

  const nav = `<nav class="toc" aria-label="Sections"><p class="toc-title">Contents</p><ol>${order.map((id) => {
    const label = SECTION_LABELS[id];
    const a = catalogue.areas.find((x) => x.section === id);
    let dot = '';
    if (a) {
      const n = areaCounts(pack, catalogue, a.code);
      const state = n['does-not-meet'] ? 'fails' : n['cannot-verify'] + n.missing ? 'unknown' : 'meets';
      dot = `<i class="dot d-${state}" title="${{ fails: 'Problems found', unknown: 'Some items could not be verified', meets: 'Everything that applies is met' }[state]}" aria-hidden="true"></i>`;
    }
    return `<li><a href="#${id}">${esc(label)}${dot}</a></li>`;
  }).join('')}</ol><p class="toc-key"><span><i class="dot d-fails"></i>problems found</span><span><i class="dot d-unknown"></i>some can't be verified</span><span><i class="dot d-meets"></i>all met</span></p></nav>`;

  const title = `${p.name || 'Untitled'} review`;
  const page = `<title>${esc(title)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..100,500..800&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>${CSS}</style>
<div class="page">
  <header class="masthead">
    <p class="kicker">${reviewed ? 'Pre-delivery inspection' : 'Review page · submitted, awaiting review'}</p>
    <h1>${esc(p.name || 'Untitled project')}</h1>
    <p class="meta">${reviewed ? `Reviewed ${esc(p.reviewedOn || '—')} by ${fmt(p.reviewer || '—')}` : `Submitted ${esc(p.date || '—')} by ${fmt(p.author || '—')}`}</p>
    <p class="guide">${reviewed ? `Section ${num('verdict')} gives the verdict and answers three questions: is the test harness properly set up, are the performance tests comprehensive, and does the architecture review cover hidden problems. Section ${num('method')} says how the inspection was done and which sources it used, section ${num('questions')} shows the evidence behind each answer, and section ${num('recommendations')} what to do. The rest is the evidence.` : 'Section 1 shows the status: the reviewer fills in the verdict. The author\'s sections start with Product.'}</p>
  </header>
  <div class="layout">${nav}<main>${body}</main></div>
  <footer class="foot">Generated from <code>review-pack.json</code> (review standard ${esc(pack.standard || catalogue.standard)}). The JSON file is the record; this page is a view of it.</footer>
</div>
<dialog id="zoom-dialog"><button type="button" class="close" aria-label="Close">Close</button><img alt=""></dialog>
<script>${SCRIPT}</script>
${fragment ? '' : '<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script><script>window.mermaid && mermaid.initialize({ startOnLoad: true, theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "neutral" });</script>'}`;
  return fragment ? page : `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${page.replace('<div class="page">', '</head>\n<body>\n<div class="page">')}\n</body>\n</html>\n`;
}

const SCRIPT = `
(function () {
  function reveal(hash) {
    var el = hash && hash.length > 1 && document.getElementById(hash.slice(1));
    var d = el && el.closest && el.closest('details');
    if (d) d.open = true;
  }
  reveal(location.hash);
  window.addEventListener('hashchange', function () { reveal(location.hash); });
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[href^="#"]');
    if (a) reveal(a.getAttribute('href'));
  });
  var dlg = document.getElementById('zoom-dialog');
  document.addEventListener('click', function (ev) {
    var z = ev.target.closest && ev.target.closest('.zoom');
    if (z && dlg && dlg.showModal) { var img = z.querySelector('img'); dlg.querySelector('img').src = img.src; dlg.querySelector('img').alt = img.alt; dlg.showModal(); }
    if (ev.target === dlg || (ev.target.classList && ev.target.classList.contains('close'))) dlg.close();
  });
})();`;

const CSS = `
/* Layout: an inspection dossier. A fixed contents rail on wide screens, one reading column, verdict stamp first. */
:root {
  --paper: #f4f6f5; --surface: #ffffff; --ink: #14201b; --muted: #55625c; --line: #d5ddd9; --accent: #0b5f8a;
  --meets: #1b7a48; --meets-bg: #e2f2e8; --fails: #b42318; --fails-bg: #fbe6e2; --unknown: #8a5a00; --unknown-bg: #fbefd6;
  --na: #66716c; --na-bg: #e9edeb; --code-bg: #eef2f0;
  --display: "Archivo", "Arial Narrow", system-ui, sans-serif; --body: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --paper: #0e1513; --surface: #151d1a; --ink: #e4ebe8; --muted: #9aa8a1; --line: #2a3632; --accent: #72b8e0;
  --meets: #5cc58c; --meets-bg: #14301f; --fails: #f2877a; --fails-bg: #3a1a16; --unknown: #e3b95b; --unknown-bg: #33280e;
  --na: #9aa8a1; --na-bg: #222c29; --code-bg: #1c2522; color-scheme: dark; } }
:root[data-theme="dark"] {
  --paper: #0e1513; --surface: #151d1a; --ink: #e4ebe8; --muted: #9aa8a1; --line: #2a3632; --accent: #72b8e0;
  --meets: #5cc58c; --meets-bg: #14301f; --fails: #f2877a; --fails-bg: #3a1a16; --unknown: #e3b95b; --unknown-bg: #33280e;
  --na: #9aa8a1; --na-bg: #222c29; --code-bg: #1c2522; color-scheme: dark; }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.55 var(--body); }
.page { max-width: 1240px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 28px 48px; }
a { color: var(--accent); }
a:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
code { font: 0.86em/1.4 var(--mono); background: var(--code-bg); padding: 0.05em 0.35em; border-radius: 3px; overflow-wrap: anywhere; }
pre { margin: 0; overflow-x: auto; }
pre code { display: block; padding: 8px 10px; white-space: pre; overflow-wrap: normal; }
h1, h2, h3, h4 { font-family: var(--display); font-stretch: 87.5%; text-wrap: balance; margin: 0; line-height: 1.15; }
.masthead { display: grid; gap: 6px; padding-bottom: 18px; border-bottom: 2px solid var(--ink); margin-bottom: 24px; }
.kicker { margin: 0; font: 600 12px/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.masthead h1 { font-size: clamp(28px, 4.2vw, 44px); font-weight: 800; }
.meta { margin: 0; display: flex; flex-wrap: wrap; gap: 4px 18px; color: var(--muted); font-size: 13.5px; }
.layout { display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 36px; align-items: start; }
.toc { position: sticky; top: calc(env(safe-area-inset-top, 0px) + 16px); font-size: 13.5px; }
.toc-title { margin: 0 0 8px; font: 600 11px/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.toc ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; counter-reset: s; }
.toc li { counter-increment: s; }
.toc a { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 4px; color: var(--ink); text-decoration: none; }
.toc a::before { content: counter(s); font: 12px var(--mono); color: var(--muted); min-width: 26px; }
.toc a:hover { background: var(--surface); }
.dot { width: 8px; height: 8px; border-radius: 50%; margin-left: auto; flex: none; }
.d-meets { background: var(--meets); } .d-fails { background: var(--fails); } .d-unknown { background: var(--unknown); }
main { min-width: 0; display: grid; gap: 22px; }
section { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 22px clamp(16px, 3vw, 28px); display: grid; gap: 14px; min-width: 0; scroll-margin-top: 16px; }
.sec-head { display: grid; gap: 4px; }
.sec-num { font: 500 12px/1 var(--mono); color: var(--muted); }
.sec-head h2 { font-size: 24px; font-weight: 700; }
.sec-q { margin: 0; color: var(--muted); font-style: italic; }
section h3 { font-size: 16px; font-weight: 700; margin-top: 6px; }
section p { margin: 0; max-width: 72ch; }
.lede { font-size: 16px; }
.lbl { font: 600 11px/1 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin-right: 6px; }
.dim { color: var(--muted); }
ul, ol { margin: 0; padding-left: 20px; display: grid; gap: 4px; }
.incomplete { border: 1px solid var(--fails); background: var(--fails-bg); border-radius: 6px; padding: 12px 14px; display: grid; gap: 8px; }
.incomplete ul { font-size: 13.5px; }
.verdict-grid { display: grid; grid-template-columns: minmax(180px, 240px) minmax(0, 1fr); gap: 24px; align-items: start; }
.stamp { display: grid; gap: 6px; justify-items: center; text-align: center; padding: 18px 12px; border: 3px double currentColor; border-radius: 8px; transform: rotate(-1.5deg); }
.stamp.nogo { color: var(--fails); } .stamp.go { color: var(--meets); } .stamp.cond { color: var(--unknown); } .stamp.wait { color: var(--muted); }
.stamp-label { font: 600 11px/1 var(--mono); letter-spacing: 0.12em; text-transform: uppercase; }
.stamp-text { font: 800 30px/1 var(--display); font-stretch: 75%; letter-spacing: 0.02em; text-transform: uppercase; }
.stamp-meta { font: 12px var(--mono); }
.verdict-text { display: grid; gap: 10px; min-width: 0; }
.reason { font-size: 17px; }
.todo { display: grid; gap: 6px; }
.score { display: grid; gap: 6px; }
.score-row { display: grid; grid-template-columns: minmax(120px, 190px) minmax(0, 1fr) 210px; gap: 12px; align-items: center; color: var(--ink); text-decoration: none; padding: 3px 0; }
.score-row:hover .score-name { text-decoration: underline; }
.score-name { font-weight: 500; }
.bar { display: flex; height: 12px; border-radius: 3px; overflow: hidden; background: var(--na-bg); gap: 2px; }
.seg { display: block; min-width: 4px; }
.k-meets { background: var(--meets); } .k-does-not-meet { background: var(--fails); } .k-cannot-verify, .k-missing { background: var(--unknown); } .k-not-applicable { background: var(--na-bg); outline: 1px solid var(--line); outline-offset: -1px; }
.score-n { font: 12.5px var(--body); font-variant-numeric: tabular-nums; text-align: right; color: var(--muted); }
.t-meets { color: var(--meets); } .t-fails { color: var(--fails); } .t-unknown { color: var(--unknown); }
.legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 12.5px; color: var(--muted); }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
.signoff { color: var(--muted); font-size: 13.5px; border-top: 1px dashed var(--line); padding-top: 10px; }
.chip { display: inline-flex; align-items: center; gap: 4px; font: 600 12px/1 var(--body); padding: 5px 8px; border-radius: 999px; white-space: nowrap; }
.r-meets { color: var(--meets); background: var(--meets-bg); }
.r-does-not-meet { color: var(--fails); background: var(--fails-bg); }
.r-cannot-verify, .r-missing { color: var(--unknown); background: var(--unknown-bg); }
.r-not-applicable, .r-optional { color: var(--na); background: var(--na-bg); }
.sev { font: 600 11px/1 var(--mono); text-transform: uppercase; letter-spacing: 0.05em; padding: 4px 6px; border-radius: 3px; border: 1px solid currentColor; }
.s-critical, .s-high { color: var(--fails); } .s-medium { color: var(--unknown); } .s-low { color: var(--na); }
.grade { font: 500 12px var(--mono); color: var(--muted); }
.fref { font: 500 12.5px var(--mono); white-space: nowrap; }
.judged { border-top: 1px solid var(--line); padding-top: 14px; display: grid; gap: 10px; }
.crits { list-style: none; padding: 0; display: grid; gap: 0; }
.crit { display: grid; grid-template-columns: 52px minmax(0, 1fr) 150px; gap: 14px; padding: 12px 0; border-top: 1px solid var(--line); }
.crit:first-child { border-top: 0; }
.crit-id { font: 600 13px/1.6 var(--mono); }
.crit-body { display: grid; gap: 4px; min-width: 0; }
.crit-title { font-weight: 600; }
.tag { font: 500 11px var(--mono); color: var(--muted); margin-left: 6px; white-space: nowrap; }
.crit-std { color: var(--muted); font-size: 13.5px; }
.crit-result { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 5px; }
table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--line); }
th { font: 600 11px/1.3 var(--mono); letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); background: var(--paper); white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
.num { font-variant-numeric: tabular-nums; }
.journeys { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: 16px; }
.journey { border: 1px solid var(--line); border-radius: 6px; padding: 14px; display: grid; gap: 8px; align-content: start; min-width: 0; }
.journey h3 { margin: 0; }
.jid { font: 600 13px var(--mono); color: var(--accent); }
.steps { gap: 3px; }
.evidence { display: grid; gap: 10px; }
.evidence figure { margin: 0; display: grid; gap: 4px; }
.evidence figcaption { font-size: 12.5px; color: var(--muted); }
.zoom { padding: 0; border: 1px solid var(--line); border-radius: 4px; background: var(--paper); cursor: zoom-in; display: block; max-width: 100%; }
.zoom img { display: block; max-width: 100%; height: auto; border-radius: 3px; }
.thumbs { grid-template-columns: repeat(auto-fill, minmax(140px, 200px)); }
.ev-file { font-size: 13px; }
.refs { font-size: 13px; color: var(--muted); }
.cmds { display: grid; gap: 10px; }
.cmd { display: grid; gap: 4px; min-width: 0; }
.diagram { overflow-x: auto; border: 1px solid var(--line); border-radius: 5px; padding: 10px; background: var(--paper); }
.diagram pre { font: 12px/1.4 var(--mono); }
.callout { border-left: 3px solid var(--accent); padding: 6px 12px; background: var(--paper); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
.stat { border: 1px solid var(--line); border-radius: 5px; padding: 10px 12px; display: grid; gap: 2px; }
.stat-v { font: 700 24px/1.1 var(--display); font-variant-numeric: tabular-nums; }
.stat-l { font-size: 12.5px; color: var(--muted); }
.classes { display: grid; gap: 14px; }
.pclass { border: 1px solid var(--line); border-radius: 6px; padding: 14px; display: grid; gap: 8px; }
.pclass header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; align-items: center; }
.pclass h4 { font-size: 17px; }
.occ-n { font: 500 12px var(--mono); color: var(--muted); }
.occ { list-style: none; padding: 0; font-size: 13.5px; gap: 4px; }
.oref { font: 500 12px var(--mono); color: var(--muted); margin-right: 4px; }
.acc { list-style: none; padding: 0; display: grid; gap: 0; }
.acc-row { border-top: 1px solid var(--line); padding: 10px 0; display: grid; gap: 8px; }
.acc-row:first-child { border-top: 0; }
.acc-head { display: grid; grid-template-columns: 52px 54px minmax(0, 1fr) auto; gap: 10px; align-items: baseline; }
.prio { font: 500 12px var(--mono); color: var(--muted); }
.findings { list-style: none; padding: 0; display: grid; gap: 0; }
.finding { border-top: 1px solid var(--line); padding: 12px 0; display: grid; gap: 6px; }
.finding:first-child { border-top: 0; }
.f-head { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.f-status { font-size: 13px; color: var(--muted); }
.f-title { font-weight: 600; }
.feats { display: flex; flex-wrap: wrap; gap: 6px; }
.feat { font-size: 12.5px; border: 1px solid var(--line); border-radius: 999px; padding: 3px 9px; color: var(--muted); }
.gloss { display: grid; grid-template-columns: minmax(120px, 200px) minmax(0, 1fr); gap: 6px 16px; margin: 0; }
.gloss dt { font-weight: 600; } .gloss dd { margin: 0; color: var(--muted); }
.foot { margin-top: 24px; color: var(--muted); font-size: 12.5px; }
dialog { border: 1px solid var(--line); border-radius: 6px; padding: 12px; background: var(--surface); color: var(--ink); max-width: min(96vw, 1200px); }
dialog::backdrop { background: rgb(0 0 0 / 0.6); }
dialog img { display: block; max-width: 100%; max-height: 82vh; margin-top: 8px; }
dialog .close { font: 500 13px var(--body); border: 1px solid var(--line); background: var(--paper); color: var(--ink); border-radius: 4px; padding: 4px 10px; cursor: pointer; }

.guide { margin: 0; max-width: 80ch; font-size: 14px; color: var(--muted); }
.details-line { color: var(--muted); font-size: 12.5px; }
.anyway { border-left: 3px solid var(--fails); padding: 8px 12px; background: var(--fails-bg); border-radius: 0 5px 5px 0; display: grid; gap: 4px; }
.stamp.go + .verdict-text .anyway { border-color: var(--meets); background: var(--meets-bg); }
.pill { display: inline-block; font: 600 11px/1 var(--mono); letter-spacing: 0.04em; text-transform: uppercase; padding: 3px 6px; border-radius: 3px; color: var(--muted); border: 1px solid var(--line); vertical-align: 1px; }
.pill-block { color: var(--fails); border-color: var(--fails); }
.todo-table table { table-layout: fixed; }
.todo-table th:nth-child(1) { width: 34px; } .todo-table th:nth-child(2) { width: 47%; } .todo-table th:nth-child(3) { width: 21%; }
.todo-table tr.is-blocker td:first-child { box-shadow: inset 3px 0 0 var(--fails); }
.refs-inline { display: block; margin-top: 3px; font-size: 12px; color: var(--muted); }
.key { border: 1px solid var(--line); border-radius: 6px; padding: 12px 14px; background: var(--paper); display: grid; gap: 8px; }
.key dl { display: grid; grid-template-columns: minmax(110px, 150px) minmax(0, 1fr); gap: 5px 14px; margin: 0; font-size: 13.5px; }
.key dt { font-weight: 600; } .key dd { margin: 0; color: var(--muted); }
.attention { list-style: none; padding: 0; display: grid; gap: 6px; font-size: 14px; }
.attention li { display: grid; gap: 3px; }
.att-head { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; }
.att-what { color: var(--muted); font-size: 13.5px; padding-left: 2px; }
.qlist { margin: 8px 0 4px; padding-left: 20px; display: grid; gap: 4px; font-size: 14px; }
.qlist .chip { margin-left: 4px; }
.points { font-size: 14px; }
.q-table td:first-child a { font-weight: 600; color: var(--ink); }
.said { display: grid; gap: 6px; padding-left: 18px; }
.top { display: grid; gap: 6px; padding-left: 22px; }
.qs { display: grid; gap: 16px; }
.q { border: 1px solid var(--line); border-radius: 8px; padding: 16px; display: grid; gap: 10px; background: var(--surface); }
.q header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.q header h3 { flex: 1 1 260px; font-size: 19px; }
.q-num { font: 700 15px/1 var(--display); color: var(--accent); border: 1.5px solid var(--accent); border-radius: 999px; width: 28px; height: 28px; display: inline-grid; place-items: center; }
.chip.ans { font-size: 14px; padding: 7px 12px; }
.q h4 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin-top: 4px; }
.q h5 { font-size: 14px; margin-bottom: 4px; }
.q-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.q-cols ul, .recs, .probs { display: grid; gap: 4px; padding-left: 18px; }
.conclusion { border-left: 3px solid var(--accent); padding: 6px 12px; background: var(--code-bg); border-radius: 0 5px 5px 0; }
.q-more { font-size: 14px; }
.decide { border: 1px solid var(--accent); border-radius: 6px; padding: 12px 14px; display: grid; gap: 6px; }
.decide ul { gap: 6px; }
.actual-diff { border-left: 3px solid var(--fails); padding-left: 8px; }
.estimate { font-size: 15px; }
details summary { cursor: pointer; font-weight: 600; font-size: 14px; padding: 6px 0; }
details[open] summary { margin-bottom: 4px; }
.f-grid { display: grid; grid-template-columns: minmax(80px, 100px) minmax(0, 1fr); gap: 4px 12px; margin: 0; font-size: 14px; }
.f-grid dt { font: 600 11px/1.9 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
.f-grid dd { margin: 0; }
.finding.is-blocker { box-shadow: inset 3px 0 0 var(--fails); padding-left: 12px; }
.done { list-style: none; padding: 0; display: grid; gap: 4px; font-size: 13.5px; }
.toc-key { display: grid; gap: 3px; margin: 10px 0 0; font-size: 12px; color: var(--muted); }
.toc-key span { display: flex; align-items: center; gap: 6px; }
.toc-key .dot { margin-left: 0; }
abbr[title] { text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; position: relative; }
abbr[title]:focus { outline: none; }
abbr[title]:focus::after { content: attr(title); position: absolute; left: 0; top: calc(100% + 4px); z-index: 20; width: max-content; max-width: min(320px, 78vw); background: var(--ink); color: var(--surface); padding: 7px 9px; border-radius: 5px; font: 400 12.5px/1.45 var(--body); white-space: normal; text-transform: none; letter-spacing: 0; }
@media (max-width: 960px) {
  .layout { grid-template-columns: minmax(0, 1fr); gap: 18px; }
  .toc { position: static; }
  .toc ol { display: flex; flex-wrap: wrap; gap: 4px; }
  .toc a { border: 1px solid var(--line); background: var(--surface); padding: 3px 8px; }
  .toc a::before { min-width: 0; }
}
@media (max-width: 640px) {
  .verdict-grid { grid-template-columns: minmax(0, 1fr); }
  .stamp { justify-self: start; min-width: 200px; }
  .score-row { grid-template-columns: minmax(0, 1fr); }
  .score-n { text-align: left; }
  .key dl, .f-grid { grid-template-columns: minmax(0, 1fr); }
  .todo-table { border: 0; }
  .todo-table table, .todo-table tbody, .todo-table tr, .todo-table td { display: block; width: auto; }
  .todo-table thead { display: none; }
  .todo-table tr { border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; }
  .todo-table td { border: 0; padding: 2px 0; }
  .todo-table td.num { display: none; }
  .todo-table td[data-label]::before { content: attr(data-label) ": "; font-weight: 600; color: var(--muted); }
  .todo-table tr.is-blocker td:first-child { box-shadow: none; }
  .todo-table tr.is-blocker { box-shadow: inset 3px 0 0 var(--fails); }
  .crit { grid-template-columns: 44px minmax(0, 1fr); }
  .crit-result { grid-column: 2; flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: flex-start; }
  .acc-head { grid-template-columns: 48px minmax(0, 1fr); }
  .acc-head .prio { display: none; }
  .acc-head .chip { grid-column: 2; justify-self: start; }
  .gloss { grid-template-columns: minmax(0, 1fr); }
}
`;

// ---------- splitting the worksheet across reviewers ----------

// Per area: how many criteria are mandatory, how many have each result, and which mandatory ones have none.
export function worksheetStatus(pack, catalogue) {
  pack = resolvePack(pack, catalogue);
  const rows = new Map((pack.worksheet || []).map((r) => [r.id, r]));
  return catalogue.areas.map((a) => {
    const cs = catalogue.criteria.filter((c) => c.id.startsWith(a.code + '-'));
    const mandatory = cs.filter((c) => applicability(c, pack.project) === 'mandatory');
    const counts = Object.fromEntries(Object.keys(RESULTS).map((k) => [k, 0]));
    for (const c of cs) if (RESULTS[rows.get(c.id)?.result]) counts[rows.get(c.id).result]++;
    return { code: a.code, name: a.name, mandatory: mandatory.length, counts, missing: mandatory.filter((c) => !RESULTS[rows.get(c.id)?.result]).map((c) => c.id) };
  });
}

// Merge worksheet rows (from one file per lens) into the pack. A later row for the same criterion replaces an earlier one.
export function mergeWorksheet(pack, rowLists) {
  const byId = new Map((pack.worksheet || []).map((r) => [r.id, r]));
  for (const rows of rowLists) for (const r of rows) if (r && r.id) byId.set(r.id, r);
  const order = (id) => 'RHADSPOQU'.indexOf(id[0]) * 100 + Number(id.slice(2));
  pack.worksheet = [...byId.values()].sort((x, y) => order(x.id) - order(y.id));
  return pack;
}

// ---------- quality gates: software does the counting ----------
//
// Language models miscount: "all 94 criteria checked" may really be 92. Each gate counts what a stage must have produced
// and lists exactly what is missing. A stage isn't done until its gate passes.

function evidencePaths(pack) {
  return [
    ...(pack.product?.journeys || []).flatMap((j) => j.evidence || []),
    ...(pack.acceptance?.rows || []).flatMap((r) => r.evidence || []),
  ].filter((e) => e.path).map((e) => e.path);
}

// Every rule that fired in the scanner output run-scanners.sh wrote, grouped by tool and rule. Each needs an entry in
// scans.triage: reported (as a finding or criterion) or dismissed (with a reason). Dropping one quietly is what this stops.
export function scannerHits(dir) {
  const hits = new Map();
  const add = (tool, rule, path, line) => {
    const key = `${tool} ${rule}`;
    if (!hits.has(key)) hits.set(key, { tool, rule, where: [] });
    const at = path ? `${path.split('/').slice(-2).join('/')}${line ? `:${line}` : ''}` : '';
    if (at && !hits.get(key).where.includes(at)) hits.get(key).where.push(at);
  };
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    let d;
    try { d = JSON.parse(readFileSync(join(dir, name), 'utf8')); } catch { continue; }
    if (/^semgrep/.test(name)) for (const r of d.results || []) add('semgrep', r.check_id.split('.').pop(), r.path, r.start?.line);
    else if (/^gitleaks/.test(name) && Array.isArray(d)) for (const r of d) add('gitleaks', r.RuleID, r.File, r.StartLine);
    else if (/^osv/.test(name)) for (const r of d.results || []) for (const p of r.packages || []) for (const v of p.vulnerabilities || []) add('osv-scanner', v.id, p.package?.name);
    else if (/^npm-audit/.test(name)) for (const [pkg, v] of Object.entries(d.vulnerabilities || {})) add('npm audit', pkg, v.severity);
    else if (/^trivy/.test(name)) for (const r of d.Results || []) for (const m of r.Misconfigurations || []) add('trivy', m.ID, r.Target);
    else if (/^data-access-rules/.test(name)) for (const f of d.findings || []) add('data-access-rules', f.rule || `${f.severity}: ${f.issue}`, f.file, f.line);
  }
  return [...hits.values()];
}

// Saved answers and logs go to people outside the team, so they must hold test data only. Email addresses are allowed at
// the reserved test domains (example.com, .test, .invalid…), and a business's role addresses (support@, info@…) aren't
// personal. What is found is described, never printed: a key in the gate's output would be one more leak. Pictures can't
// be read this way; the author looks at those.
const TEXT_EVIDENCE = /\.(json|txt|md|log|csv|xml|ya?ml)$/i;
const TEST_DOMAIN = /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$/i;
const NOT_A_DOMAIN = /\.(png|jpe?g|gif|svg|webp|avif|ico|m?js|css|map|json)$/i; // logo@2x.png
const ROLE_ADDRESS = /^(support|info|hello|contact|help|sales|team|admin|billing|no-?reply)$/i;
const KEYS = [
  [/\b[rs]k_live_[0-9A-Za-z]{10,}/, 'a live Stripe key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}/, 'a GitHub token'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
  [/\bAIza[0-9A-Za-z_-]{35}/, 'a Google API key'],
];
export function personalDataIn(text) {
  const found = new Set();
  for (const m of text.matchAll(/([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g)) {
    const [, local, domain] = m;
    if (!TEST_DOMAIN.test(domain) && !NOT_A_DOMAIN.test(domain) && !ROLE_ADDRESS.test(local)) found.add(`an email address at ${domain.toLowerCase()} (use example.com or a .test domain)`);
  }
  for (const [re, what] of KEYS) if (re.test(text)) found.add(what);
  return [...found];
}

// The README's nine items (standard §1.1), found by their labels as bold text or headings.
export const README_ITEMS = ['What it is', 'Review page', 'Quick start', 'Test access', 'Tests', 'Settings', 'Architecture', 'Known problems', 'For AI agents'];

export function readmeItems(text) {
  const has = (label) => new RegExp(`(^|\\n)\\s*(#{1,6}\\s*|\\*\\*|__)${label.replace(/ /g, '\\s+')}\\b`, 'i').test(text);
  return { present: README_ITEMS.filter(has), missing: README_ITEMS.filter((l) => !has(l)), linksPage: /review\/index\.html/.test(text) };
}

export function gate(stage, pack, catalogue, { baseDir = '.', areas, readme, scans } = {}) {
  const checks = [];
  const add = (name, expected, found, missing = [], label = 'missing') => checks.push({ name, expected, found, missing, label, ok: found === expected && missing.length === 0 });
  const codes = areas && areas.length ? areas : catalogue.areas.map((a) => a.code);

  if (stage === 'submission' || stage === 'review') {
    const errors = validatePack(pack, catalogue, { stage }).filter((p) => p.level === 'error');
    add(`Checker errors (${stage})`, 0, errors.length, errors.map((e) => `${e.where}: ${e.message}`));
    const journeys = pack.product?.journeys || [];
    const shown = journeys.filter((j) => filled(j.evidence));
    add('Demo journeys with evidence', journeys.length, shown.length, journeys.filter((j) => !filled(j.evidence)).map((j) => j.id || j.name));
    const paths = evidencePaths(pack);
    const present = paths.filter((p) => existsSync(resolve(baseDir, p)));
    add('Evidence files that exist', paths.length, present.length, paths.filter((p) => !existsSync(resolve(baseDir, p))));
    const leaks = present.filter((p) => TEXT_EVIDENCE.test(p)).flatMap((p) => personalDataIn(readFileSync(resolve(baseDir, p), 'utf8')).map((what) => `${p}: ${what}`));
    add('Saved text evidence with real email addresses or keys', 0, leaks.length, leaks, 'found');
  }
  if (stage === 'submission') {
    // The README is the author's to complete. At hand-in it is checked here; in a review it is judged as criteria R-01 to R-09.
    const readmePath = readme || resolve(baseDir, '..', 'README.md');
    if (!existsSync(readmePath)) add('README items (standard §1.1)', README_ITEMS.length, 0, [`no README at ${readmePath}`]);
    else {
      const r = readmeItems(readFileSync(readmePath, 'utf8'));
      add('README items (standard §1.1)', README_ITEMS.length, r.present.length, r.missing);
      add('README links to the review page', 1, r.linksPage ? 1 : 0, r.linksPage ? [] : ['a link to review/index.html']);
    }
  }
  if (stage === 'worksheet' || stage === 'review') {
    const rows = new Map((pack.worksheet || []).map((r) => [r.id, r]));
    for (const code of codes) {
      // Every yes/no question of every mandatory criterion needs an answer (a whole criterion may be not applicable).
      let total = 0;
      const open = [];
      for (const c of catalogue.criteria.filter((x) => x.id.startsWith(code + '-') && applicability(x, pack.project) === 'mandatory')) {
        const r = rows.get(c.id);
        const qs = (c.checks || []).map((x) => x.id);
        total += qs.length;
        if (r && rowOutcome(r, c).result === 'not-applicable') continue;
        open.push(...(r?.answers ? rowOutcome(r, c).unanswered : qs));
      }
      add(`${code}: questions answered`, total, total - open.length, open);
    }
    // The records behind the three questions, counted with the lens that writes them.
    const ins = inspection(pack, catalogue);
    if (codes.includes('H')) {
      const suites = pack.harness?.suites || [];
      add('Test suites with a type', suites.length, suites.filter((x) => x.type).length, suites.filter((x) => !x.type).map((x) => x.name || '(unnamed)'));
    }
    if (codes.includes('P')) {
      const due = ins.performance.kinds.filter((k) => k.mandatory);
      const ok = due.filter((k) => PERF_RESULTS[k.result]);
      add('Kinds of performance test with a result (run or not)', due.length, ok.length, due.filter((k) => !ok.includes(k)).map((k) => `${k.id}: ${k.name}`));
    }
    if (codes.includes('A')) {
      const ok = ins.hidden.areas.filter((a) => HIDDEN_RESULTS[a.result]);
      add('Places hidden problems sit, each with a result', ins.hidden.areas.length, ok.length, ins.hidden.areas.filter((a) => !ok.includes(a)).map((a) => `${a.id}: ${a.name}`));
    }
    if (codes.includes('Q')) {
      const cls = pack.history?.classes || [];
      const ok = cls.filter((c) => filled(c.catchWith));
      add('Recurring problems with the kind of test that would catch them', cls.length, ok.length, cls.filter((c) => !ok.includes(c)).map((c) => c.name));
    }
  }
  if (stage === 'review') {
    const blockers = new Set((pack.verdict?.blockers || []).flatMap((b) => b.refs || []));
    const serious = (pack.findings || []).filter((f) => ['Critical', 'High'].includes(f.severity) && !/^fixed/i.test(f.status || ''));
    add('Open Critical and High findings listed as blockers', serious.length, serious.filter((f) => blockers.has(f.id)).length, serious.filter((f) => !blockers.has(f.id)).map((f) => f.id));
    const ids = new Set((pack.findings || []).map((f) => f.id));
    const bl = pack.verdict?.blockers || [];
    const carded = bl.filter((b) => (b.refs || []).some((r) => ids.has(r)));
    add('Blockers with a card in What to fix', bl.length, carded.length, bl.filter((b) => !carded.includes(b)).map((b) => (b.text || '').slice(0, 60)));
    const must = (pack.acceptance?.rows || []).filter((r) => r.priority === 'Must');
    const judged = must.filter((r) => ['pass', 'fail', 'flaky', 'external'].includes(r.status));
    add('Must acceptance criteria with a result', must.length, judged.length, must.filter((r) => !judged.includes(r)).map((r) => r.id));
    const src = methodSources(pack, catalogue);
    const told = src.filter((x) => x.entry && typeof x.entry.used === 'boolean');
    add('Sources of evidence, each used or explained', src.length, told.length, src.filter((x) => !told.includes(x)).map((x) => `${x.id}: ${x.name}`));
    const scanDir = scans || (pack.scans?.output ? resolve(baseDir, pack.scans.output) : resolve(baseDir, 'scans'));
    if (!existsSync(scanDir)) add('Scanner output found', 1, 0, [`no folder at ${scanDir}: run run-scanners.sh, record the folder in scans.output (or pass --scans)`]);
    else {
      const triaged = new Set((pack.scans?.triage || []).map((t) => `${(t.tool || '').toLowerCase()} ${t.rule}`));
      const hits = scannerHits(scanDir);
      const open = hits.filter((h) => !triaged.has(`${h.tool} ${h.rule}`));
      add('Scanner rules that fired, each reported or dismissed', hits.length, hits.length - open.length, open.map((h) => `${h.tool} ${h.rule} (${h.where.slice(0, 4).join(', ')}${h.where.length > 4 ? ', …' : ''})`));
    }
  }
  return { ok: checks.every((c) => c.ok), checks };
}

// ---------- the written report ----------
// REPORT.md is generated from the same record as the page, so every inspection reads the same way: the evidence and the
// conclusions first, then how they were reached, the results, the recommendations and the limits.
const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const mdTable = (headers, rows) => [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)];

export function reportMarkdown(pack, catalogue) {
  pack = resolvePack(pack, catalogue);
  const p = pack.project || {};
  const v = pack.verdict || {};
  const ins = inspection(pack, catalogue);
  const said = conclusions(ins);
  const hz = ins.harness, pf = ins.performance, hd = ins.hidden;
  const findings = pack.findings || [];
  const open = findings.filter((f) => !/^fixed/i.test(f.status || '')).sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
  const keys = Object.keys(QUESTIONS);
  const evidence = {
    harness: `${hz.yes} of ${hz.points} harness questions answered yes${hz.recurring ? `; ${recurringText(hz)}` : ''}`,
    performance: pf.total ? `${pf.run} of ${pf.total} kinds of performance test run; ${pf.passed} passed, ${pf.failed} failed` : 'none required at this risk tier',
    hidden: `${hd.examined} of ${hd.total} places examined; ${hd.found.length} hidden problem${hd.found.length === 1 ? '' : 's'} found`,
  };
  const todo = [...(v.blockers || []).map((b) => ({ ...b, kind: 'Blocker', when: 'Before delivery' })), ...(v.conditions || []).map((c) => ({ ...c, kind: 'Condition', when: c.when || 'Before delivery' }))];
  const L = [];
  L.push(`# Pre-delivery inspection: ${p.name || 'Untitled'}`, '');
  L.push(`Version \`${p.commit || '—'}\`${p.versionNote ? ` (${p.versionNote})` : ''} · inspected ${p.reviewedOn || '—'} by ${p.reviewer || '—'} · risk tier ${p.riskTier}. Generated from \`review-pack.json\`; the review page shows the same record with all the evidence.`, '');

  L.push('## 1. Summary: evidence and conclusions', '');
  L.push(`**Verdict: ${v.decision || 'not given'}.** ${v.reason || ''}`, '');
  if (v.ifLaunchedNow) L.push(`**If it were delivered or launched now:** ${v.ifLaunchedNow}`, '');
  L.push(`*${QUESTIONS_NOTE}*`, '');
  L.push(...mdTable(['Question', 'Answer', 'Evidence'], keys.map((k, i) => [`${i + 1}. ${QUESTIONS[k].title}`, `**${ins[k].answer}**`, evidence[k]])), '');
  for (const k of keys) L.push(`- ${said[k]}`);
  L.push('');
  if ((v.blockers || []).length) {
    L.push(`**Before delivery (${v.blockers.length} blocker${v.blockers.length === 1 ? '' : 's'}):**`, '');
    v.blockers.forEach((b, i) => L.push(`${i + 1}. ${b.text}`));
    L.push('');
  }
  if (v.estimate) L.push(`**When it could be delivered:** ${v.estimate}`, '');

  L.push('## 2. How the inspection was done', '');
  L.push('### Sources of evidence', '');
  L.push(...mdTable(['Source', 'Used', 'What was used, or why not'], methodSources(pack, catalogue).map((x) => [x.name, x.entry ? (x.entry.used ? 'Yes' : 'No') : 'not recorded', x.entry?.detail || ''])), '');
  if (filled(pack.method?.skills)) L.push('### Skills and tools used', '', ...mdTable(['Skill or tool', 'What it did'], pack.method.skills.map((x) => [x.name, x.how || ''])), '');
  L.push('**How the answers are worked out.** Software counts them from the record: everything done is Yes, at least half is Partly, less than half is No. Every checklist result carries its evidence grade: A, the inspector ran or measured it; B, the inspector read the code or settings; C, a statement only, which never counts as proof.', '');

  L.push('## 3. Results', '');
  L.push(`### 3.1 ${QUESTIONS.harness.title} ${hz.answer}`, '', `*${QUESTIONS.harness.why}*`, '');
  L.push(`**Evidence.** ${hz.yes} of ${hz.points} harness questions answered yes; ${hz.met} of ${hz.total} checks fully met.`, '');
  const noHarness = hz.questions.filter((x) => x.answer !== 'yes' && x.answer !== 'n/a');
  if (noHarness.length) L.push('Answered no, or not known:', '', ...noHarness.map((x) => `- ${x.criterion} ${x.q} **${ANSWER_WORDS[x.answer] || 'No answer'}**`), '');
  const inPlace = hz.checks.filter((x) => x.result === 'meets');
  const missing = hz.checks.filter((x) => x.result !== 'meets');
  if (inPlace.length) L.push(`In place: ${inPlace.map((x) => `${x.id} ${x.title}`).join('; ')}.`, '');
  if (missing.length) L.push('Missing or unproven:', '', ...missing.map((x) => `- ${x.id} ${x.title} (${x.result === 'missing' ? 'no result' : RESULTS[x.result].toLowerCase()})${x.text ? `. ${x.label}: ${x.text}` : ''}`), '');
  if (hz.recurring) {
    L.push(`${hz.recurring} kinds of problem came back during the project; ${recurringText(hz).replace(/^of the \d+ kinds of problem that came back, /, '')}. The kind of test that would catch each:`, '');
    L.push(...mdTable(['Kind of test', 'In the project', 'Would catch these problems that came back'], hz.testKinds.filter((k) => k.suites.length || k.needed.length).map((k) => [k.name, k.suites.length ? `Yes: ${k.suites.join(', ')}` : '**No**', k.needed.map((n) => `${n.name} (${n.times} time${n.times === 1 ? '' : 's'}${n.caught ? ', caught now' : ''})`).join('; ') || '—'])), '');
  }
  L.push(`**Conclusion.** ${said.harness}`, '');
  L.push(`### 3.2 ${QUESTIONS.performance.title} ${pf.answer}`, '', `*${QUESTIONS.performance.why}*`, '');
  L.push(...mdTable(['Kind of test', 'Result', 'What it showed'], pf.kinds.map((k) => [`${k.name}${k.mandatory ? '' : ' (recommended)'}`, PERF_RESULTS[k.result] || 'No result', k.note])), '');
  L.push(`**Conclusion.** ${said.performance}`, '');
  L.push(`### 3.3 ${QUESTIONS.hidden.title} ${hd.answer}`, '', `*${QUESTIONS.hidden.why}*`, '');
  L.push(...mdTable(['Where hidden problems sit', 'Result', 'How the review looked', 'Problems'], hd.areas.map((a) => [a.name, HIDDEN_RESULTS[a.result] || 'No result', a.how, a.refs.join(', ')])), '');
  if (hd.found.length) L.push(`The ${hd.found.length} hidden problem${hd.found.length === 1 ? '' : 's'}, most serious first:`, '', ...hd.found.map((f) => `- ${f.id} (${f.severity || '?'}) ${f.title || ''}`), '');
  L.push(`**Conclusion.** ${said.hidden}`, '');

  L.push('## 4. Recommendations', '');
  if (todo.length) L.push('### What has to happen', '', ...mdTable(['#', 'What has to happen', 'Who', 'How big', 'When'], todo.map((t, i) => [i + 1, `**${t.kind}:** ${t.text}${(t.refs || []).length ? ` (${t.refs.join(', ')})` : ''}`, t.who || 'not assigned', t.effort || '—', t.when])), '');
  if (hz.recommend.length) {
    L.push('### Strengthen the test harness', '', 'So the problems that came back can\'t come back again unnoticed. Most needed first:', '');
    hz.recommend.forEach((k, i) => { const t = recommendText(k); L.push(`${i + 1}. **${t.what}** ${t.forWhat} ${t.catches}${k.skills.length ? ` Skills and tools: ${k.skills.map((x) => x.name).join(', ')}.` : ''}`); });
    L.push('');
  }
  const notRun = pf.kinds.filter((k) => k.mandatory && !(k.result === 'pass' || k.result === 'fail'));
  if (notRun.length) L.push('### Complete the performance tests', '', 'Run these tests:', '', ...notRun.map((k) => `- **${k.name}.** ${k.proves}`), '');
  const notLooked = hd.areas.filter((a) => !(a.result === 'found' || a.result === 'none-found'));
  if (notLooked.length) L.push('### Look where the review did not', '', ...notLooked.map((a) => `- **${a.name}.** ${a.look}`), '');
  if (filled(catalogue.toolbox)) {
    L.push('### Skills and tools the team can use', '', 'Install them in Claude Code so the AI agents that write the code also write and run these tests.', '');
    L.push(...mdTable(['Skill or tool', 'From', 'Helps build', 'What it does'], catalogue.toolbox.map((t) => [/^https?:/.test(t.link) ? `[${t.name}](${t.link})` : `\`${t.name}\``, t.from, t.kinds.map((k) => (catalogue.testKinds.find((x) => x.id === k) || { name: k }).name.toLowerCase()).join(', ') || '—', t.what])), '');
  }
  if (filled(v.decisions)) L.push('### Decisions only the owner can make', '', ...v.decisions.map((d) => `- ${d.text}`), '');

  L.push('## 5. Limits: what was not checked', '', ...(filled(pack.notChecked) ? pack.notChecked.map((x) => `- ${x}`) : ['Nothing listed.']), '');
  L.push('An inspection lowers the risk; it does not prove there are no problems.', '');

  L.push('## Appendix A. Every open problem', '');
  if (!open.length) L.push('None.', '');
  for (const f of open) {
    L.push(`### ${f.id} · ${f.severity || '?'}${f.confidence ? ` · ${f.confidence}` : ''}: ${f.title || ''}`, '');
    for (const [label, value] of [['Impact', f.impact], ['Where', f.where], ['Evidence', f.evidence], ['Fix', f.fix], ['Done when', f.doneWhen], ['Who', f.who], ['Status', f.status]]) if (value) L.push(`- **${label}:** ${value}`);
    L.push('');
  }
  L.push('## Appendix B. Checklist results by area', '', 'Every criterion in the standard, including those that don\'t apply to this product (`review-pack.mjs status` counts only the mandatory ones).', '');
  const pts = checklistPoints(pack, catalogue);
  L.push(...mdTable(['Area', 'Points (yes answers)', 'Meet', "Don't meet", "Can't verify", "Don't apply"], catalogue.areas.map((a) => { const n = areaCounts(pack, catalogue, a.code); const ap = pts.areas.find((x) => x.code === a.code); return [`${a.code} ${a.name}`, `${ap.yes} of ${ap.total}`, n.meets, n['does-not-meet'], n['cannot-verify'] + n.missing, n['not-applicable']]; })), '');
  L.push(`Checklist points in all: **${pts.yes} of ${pts.total}**.`, '');
  if (filled(pack.glossary)) L.push('## Appendix C. Glossary', '', ...pack.glossary.map((g) => `- **${g.term}:** ${g.meaning}`), '');
  return L.join('\n');
}

// ---------- comparing two inspections ----------
// Two inspections of the same version should agree. This counts where they do, question by question.
export function comparePacks(a, b, catalogue) {
  const ra = resolvePack(a, catalogue), rb = resolvePack(b, catalogue);
  const rowsA = new Map(ra.worksheet.map((r) => [r.id, r])), rowsB = new Map(rb.worksheet.map((r) => [r.id, r]));
  let qBoth = 0, qSame = 0, cBoth = 0, cSame = 0;
  const differences = [];
  for (const c of catalogue.criteria) {
    const x = rowsA.get(c.id), y = rowsB.get(c.id);
    if (!x || !y) continue;
    if (x.result && y.result) { cBoth++; if (x.result === y.result) cSame++; }
    for (const q of c.checks || []) {
      const ax = x.answers?.[q.id], ay = y.answers?.[q.id];
      if (!ANSWER_VALUES.includes(ax) || !ANSWER_VALUES.includes(ay)) continue;
      qBoth++;
      if (ax === ay) qSame++;
      else differences.push({ id: q.id, q: q.q, a: ax, b: ay });
    }
  }
  const pa = checklistPoints(a, catalogue), pb = checklistPoints(b, catalogue);
  const ia = inspection(a, catalogue), ib = inspection(b, catalogue);
  return {
    questions: { both: qBoth, same: qSame }, criteria: { both: cBoth, same: cSame },
    verdict: [a.verdict?.decision || '—', b.verdict?.decision || '—'],
    answers: Object.keys(QUESTIONS).map((k) => ({ key: k, a: ia[k].answer, b: ib[k].answer })),
    points: pa.areas.map((x, i) => ({ code: x.code, name: x.name, a: `${x.yes}/${x.total}`, b: `${pb.areas[i].yes}/${pb.areas[i].total}` })),
    totalPoints: [`${pa.yes}/${pa.total}`, `${pb.yes}/${pb.total}`],
    differences,
  };
}

export function compareMarkdown(cmp) {
  const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—');
  return [
    '# Two inspections compared', '',
    `- **Same answer on ${cmp.questions.same} of ${cmp.questions.both} questions** (${pct(cmp.questions.same, cmp.questions.both)}).`,
    `- Same result on ${cmp.criteria.same} of ${cmp.criteria.both} criteria (${pct(cmp.criteria.same, cmp.criteria.both)}).`,
    `- Verdict: ${cmp.verdict[0]} and ${cmp.verdict[1]}.`,
    `- Checklist points: ${cmp.totalPoints[0]} and ${cmp.totalPoints[1]}.`, '',
    '| Question | First | Second |', '|---|---|---|',
    ...cmp.answers.map((x) => `| ${QUESTIONS[x.key].title} | ${x.a} | ${x.b} |`), '',
    '| Area | Points, first | Points, second |', '|---|---|---|',
    ...cmp.points.map((x) => `| ${x.code} ${x.name} | ${x.a} | ${x.b} |`), '',
    cmp.differences.length ? `## Questions answered differently (${cmp.differences.length})` : '## No question was answered differently', '',
    ...cmp.differences.map((d) => `- **${d.id}** ${d.q} First: ${d.a}; second: ${d.b}.`), '',
  ].join('\n');
}

// ---------- template and criteria list ----------

export function templatePack(catalogue, { tier = 2, features = [], stage = 'submission' } = {}) {
  const project = { name: 'TODO', summary: 'TODO: what it does and for whom, in plain words', repository: 'TODO', commit: 'TODO', date: 'TODO', author: 'TODO', riskTier: tier, riskReason: 'TODO', features, reviewer: '', reviewedOn: '' };
  const pack = {
    standard: catalogue.standard,
    stage: 'submission',
    project,
    verdict: { decision: '', reason: '', blockers: [], conditions: [], signedBy: '', signedOn: '' },
    product: {
      users: 'TODO',
      journeys: [{ id: 'J1', name: 'TODO', who: 'TODO', steps: ['TODO'], expected: 'TODO', evidence: [{ path: 'evidence/j1.png', caption: 'TODO' }], criteria: ['AC-01'] }],
      outOfScope: [],
    },
    run: { prerequisites: ['TODO'], setup: ['TODO'], start: 'TODO', open: 'TODO', test: ['TODO'], reset: '', staging: null, accounts: [], settings: [] },
    requirements: [{ id: 'RQ-1', text: 'TODO', target: 'TODO', agreedBy: 'TODO', agreedOn: 'TODO' }],
    architecture: { summary: 'TODO', diagram: '', components: [{ name: 'TODO', job: 'TODO', tech: '' }], entryPoints: [{ entry: 'TODO', caller: 'TODO', guard: '', touches: '' }], dataStores: [], services: [], decisions: [] },
    rules: [],
    harness: { agentFile: null, suites: [], ci: [], checks: [] },
    performance: { coverage: [] },
    history: { period: '', sources: [], stats: [], classes: [], hotspots: [], known: [] },
    acceptance: { criteriaVersion: 'TODO', agreedBy: 'TODO', run: '', rows: [{ id: 'AC-01', priority: 'Must', criterion: 'TODO', status: 'not-run', evidence: [] }] },
    areaNotes: {},
    findings: [],
    worksheet: catalogue.criteria
      .filter((c) => applicability(c, project) === 'mandatory')
      .map((c) => ({ id: c.id, answers: Object.fromEntries((c.checks || []).map((q) => [q.id, ''])), grade: '', evidence: '', note: '', needed: '' })),
    notChecked: [],
    glossary: [],
  };
  if (stage !== 'review') return pack;
  // A reviewer starting without a hand-in gets every reviewer field laid out, including one empty entry per item the
  // gates count, so what is left to fill in is visible and counted.
  return {
    ...pack,
    stage: 'review',
    project: { ...project, author: 'No hand-in: built by the reviewer from the code', reviewer: 'TODO', reviewedOn: 'TODO' },
    verdict: { decision: '', reason: '', ifLaunchedNow: '', blockers: [], conditions: [], decisions: [], estimate: '', noticeable: [], signer: '', signedBy: '', signedOn: '' },
    method: { sources: catalogue.evidenceSources.map((x) => ({ source: x.id, used: null, detail: '' })), skills: [] },
    architecture: { ...pack.architecture, hiddenChecks: catalogue.hiddenIssueAreas.map((a) => ({ area: a.id, result: '', how: '', refs: [] })) },
    performance: { target: '', environment: '', runs: [], steps: [], race: null, slowPartner: '', conclusion: '', coverage: catalogue.performanceTests.filter((k) => applicability(k, project) !== 'off').map((k) => ({ kind: k.id, result: '', by: 'reviewer', note: '' })) },
    scans: { output: 'scans', triage: [] },
    history: { ...pack.history, classes: [] },
  };
}

export function criteriaMarkdown(catalogue) {
  const lines = [
    '# Review criteria',
    '',
    `Standard ${catalogue.standard}. Generated from \`criteria.json\` by \`scripts/review-pack.mjs criteria\`; edit the JSON, not this file.`,
    '',
    'Each criterion is **mandatory from** the risk tier shown, and recommended below it. Criteria with a condition apply only to products with that feature. **Lowest grade** is the weakest evidence that can support a "meets": A = the reviewer ran, reproduced or measured it; B = the reviewer inspected the thing itself; C = a statement only.',
    '',
    'Each criterion is judged by its **yes/no questions**: the reviewer answers each one (yes, no, unknown, or n/a with a reason), and the software works out the result (any no: does not meet; any unknown: cannot verify; otherwise meets) and the severity (the most serious "a no is" among the questions answered no). Each yes is one point.',
    '',
  ];
  for (const a of catalogue.areas) {
    const cs = catalogue.criteria.filter((c) => c.id.startsWith(a.code + '-'));
    lines.push(`## ${a.code}: ${a.name} (${cs.length})`, '', `*${a.question}*`, '', '| ID | Criterion | Standard | Questions (a no is…) | Evidence | Mandatory from | Lowest grade |', '|---|---|---|---|---|---|---|');
    for (const c of cs) {
      const cond = c.when ? `<br>*Only if the product ${c.when.map((w) => catalogue.features[w]).join(' or ')}.*` : '';
      const src = c.source ? `<br>*Source: ${c.source}*` : '';
      const qs = (c.checks || []).map((q) => `${q.id.split('.')[1]}. ${q.q} (${q.ifNo})`).join('<br>');
      lines.push(`| ${c.id} | **${c.title}** | ${c.standard}${cond}${src} | ${qs} | ${c.evidence} | Tier ${c.tier} | ${c.minGrade} |`);
    }
    lines.push('');
  }
  const when = (k) => (k.when ? ` Only if the product ${k.when.map((w) => catalogue.features[w]).join(' or ')}.` : '');
  lines.push('## The three questions: what the inspection counts', '', 'An inspection answers three questions before delivery. Besides the criteria, it records these, and the software counts them (`review-pack.mjs gate`).', '');
  lines.push(`### Kinds of performance test (${catalogue.performanceTests.length})`, '', '*Are the performance tests comprehensive?* Each kind is recorded as passed, failed or not run, in `performance.coverage`.', '', '| ID | Kind of test | What it proves | Needed from |', '|---|---|---|---|');
  for (const k of catalogue.performanceTests) lines.push(`| \`${k.id}\` | **${k.name}** | ${k.proves}${when(k)} | Tier ${k.tier} |`);
  lines.push('', `### Where hidden problems sit (${catalogue.hiddenIssueAreas.length})`, '', '*Does the architecture review cover hidden problems?* Each place is recorded as problems found, none found or not checked, with how the review looked, in `architecture.hiddenChecks`.', '', '| ID | Place | What to look for | Related criteria |', '|---|---|---|---|');
  for (const a of catalogue.hiddenIssueAreas) lines.push(`| \`${a.id}\` | **${a.name}** | ${a.look} | ${a.criteria.join(', ') || '—'} |`);
  lines.push('', `### Kinds of automatic test (${catalogue.testKinds.length})`, '', '*Is the test harness properly set up?* Each test suite has one of these types (`harness.suites[].type`), and each problem that came back names the kinds that would catch it (`history.classes[].catchWith`).', '', '| ID | Kind of test | Catches |', '|---|---|---|');
  for (const k of catalogue.testKinds) lines.push(`| \`${k.id}\` | **${k.name}** | ${k.catches} |`);
  lines.push('', `### Sources of evidence (${catalogue.evidenceSources.length})`, '', 'Each is recorded as used (with what) or not (with why), in `method.sources`.', '', '| ID | Source | Why it matters |', '|---|---|---|');
  for (const x of catalogue.evidenceSources) lines.push(`| \`${x.id}\` | **${x.name}** | ${x.why} |`);
  lines.push('', `### Skills and tools the report recommends (${catalogue.toolbox.length})`, '', '| Skill or tool | From | Helps build | What it does |', '|---|---|---|---|');
  for (const t of catalogue.toolbox) lines.push(`| ${/^https?:/.test(t.link) ? `[${t.name}](${t.link})` : `\`${t.name}\``} | ${t.from} | ${t.kinds.join(', ') || '—'} | ${t.what} |`);
  lines.push('');
  return lines.join('\n');
}

// ---------- command line ----------

function arg(args, name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  const catalogue = loadCatalogue();
  if (cmd === 'validate' && args[0]) {
    const pack = JSON.parse(readFileSync(args[0], 'utf8'));
    const stage = arg(args, '--stage', pack.stage || 'submission');
    const problems = validatePack(pack, catalogue, { stage });
    const errors = problems.filter((x) => x.level === 'error');
    for (const x of problems) console.log(`${x.level === 'error' ? 'ERROR' : 'warn '}  ${x.where}: ${x.message}`);
    if (stage === 'review' && DECISIONS.includes(pack.verdict?.decision)) {
      const { ceiling } = verdictCeiling(pack, catalogue);
      console.log(`Verdict given: ${pack.verdict.decision}. Most favourable verdict the worksheet allows: ${ceiling}.`);
    }
    console.log(errors.length ? `${errors.length} error(s): the ${stage} is not complete.` : `OK: the ${stage} is complete.`);
    process.exit(errors.length ? 1 : 0);
  } else if (cmd === 'render' && args[0] && args[1]) {
    const pack = JSON.parse(readFileSync(args[0], 'utf8'));
    writeFileSync(args[1], renderPage(pack, { baseDir: dirname(resolve(args[0])), fragment: args.includes('--fragment'), catalogue }));
    console.log(`Wrote ${args[1]}`);
  } else if (cmd === 'template' && args[0]) {
    const tier = Number(arg(args, '--tier', '2'));
    const features = (arg(args, '--features', '') || '').split(',').filter(Boolean);
    writeFileSync(args[0], JSON.stringify(templatePack(catalogue, { tier, features, stage: arg(args, '--stage', 'submission') }), null, 2) + '\n');
    console.log(`Wrote ${args[0]}`);
  } else if (cmd === 'gate' && ['submission', 'worksheet', 'review'].includes(args[0]) && args[1]) {
    const pack = JSON.parse(readFileSync(args[1], 'utf8'));
    const areas = (arg(args, '--areas', '') || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    const result = gate(args[0], pack, catalogue, { baseDir: dirname(resolve(args[1])), areas, readme: arg(args, '--readme'), scans: arg(args, '--scans') && resolve(arg(args, '--scans')) });
    for (const c of result.checks) {
      console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}: expected ${c.expected}, found ${c.found}`);
      for (const m of c.missing.slice(0, 40)) console.log(`        ${c.label}: ${m}`);
      if (c.missing.length > 40) console.log(`        …and ${c.missing.length - 40} more`);
    }
    console.log(result.ok ? `GATE PASSED (${args[0]}).` : `GATE FAILED (${args[0]}): finish the missing items, then run the gate again.`);
    process.exit(result.ok ? 0 : 1);
  } else if (cmd === 'status' && args[0]) {
    const pack = JSON.parse(readFileSync(args[0], 'utf8'));
    let missing = 0;
    for (const s of worksheetStatus(pack, catalogue)) {
      missing += s.missing.length;
      const c = s.counts;
      console.log(`${s.code} ${s.name.padEnd(24)} mandatory ${String(s.mandatory).padStart(2)} · meets ${c.meets} · does not meet ${c['does-not-meet']} · cannot verify ${c['cannot-verify']} · n/a ${c['not-applicable']}${s.missing.length ? ` · MISSING ${s.missing.join(' ')}` : ''}`);
    }
    console.log(missing ? `${missing} mandatory criteria have no result yet.` : 'Every mandatory criterion has a result.');
  } else if (cmd === 'merge' && args.length >= 2) {
    const pack = JSON.parse(readFileSync(args[0], 'utf8'));
    const docs = args.slice(1).map((f) => JSON.parse(readFileSync(f, 'utf8')));
    const lists = docs.map((d) => (Array.isArray(d) ? d : d.worksheet || []));
    // A lens file may also carry its part of the inspection record: the performance lens its kinds of test, the
    // architecture lens where it looked for hidden problems.
    for (const d of docs.filter((x) => !Array.isArray(x))) {
      if (d.coverage) pack.performance = { ...(pack.performance || {}), coverage: d.coverage };
      if (d.hiddenChecks) pack.architecture = { ...(pack.architecture || {}), hiddenChecks: d.hiddenChecks };
    }
    writeFileSync(args[0], JSON.stringify(mergeWorksheet(pack, lists), null, 2) + '\n');
    console.log(`Merged ${lists.reduce((n, l) => n + l.length, 0)} rows into ${args[0]}`);
  } else if (cmd === 'compare' && args[0] && args[1]) {
    const [a, b] = [args[0], args[1]].map((f) => JSON.parse(readFileSync(f, 'utf8')));
    const md = compareMarkdown(comparePacks(a, b, catalogue));
    if (args[2]) { writeFileSync(args[2], md); console.log(`Wrote ${args[2]}`); } else console.log(md);
  } else if (cmd === 'report' && args[0] && args[1]) {
    const pack = JSON.parse(readFileSync(args[0], 'utf8'));
    writeFileSync(args[1], reportMarkdown(pack, catalogue));
    console.log(`Wrote ${args[1]}`);
  } else if (cmd === 'criteria' && args[0]) {
    writeFileSync(args[0], criteriaMarkdown(catalogue) + '\n');
    console.log(`Wrote ${args[0]}`);
  } else {
    console.error('Usage:\n  review-pack.mjs validate <pack.json> [--stage submission|review]\n  review-pack.mjs gate <submission|worksheet|review> <pack.json> [--areas S,A] [--readme README.md] [--scans dir]\n  review-pack.mjs render <pack.json> <out.html> [--fragment]\n  review-pack.mjs report <pack.json> <REPORT.md>\n  review-pack.mjs compare <first.json> <second.json> [out.md]\n  review-pack.mjs template <out.json> [--tier 1|2|3] [--features a,b] [--stage review]\n  review-pack.mjs status <pack.json>\n  review-pack.mjs merge <pack.json> <rows.json>...\n  review-pack.mjs criteria <out.md>');
    process.exit(2);
  }
}
