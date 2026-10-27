#!/usr/bin/env node
// Review pack: check it against the review standard and render it as one self-contained web page.
//
//   node review-pack.mjs validate <pack.json> [--stage submission|review]
//   node review-pack.mjs gate     <submission|worksheet|review> <pack.json> [--areas S,A] [--readme README.md]   (counts; exit 1 if anything is missing)
//   node review-pack.mjs render   <pack.json> <out.html> [--fragment]
//   node review-pack.mjs template <out.json> [--tier 1|2|3] [--features money,accounts,...]
//   node review-pack.mjs status   <pack.json>                  (per area: results so far, mandatory criteria still missing)
//   node review-pack.mjs merge    <pack.json> <rows.json>...   (add worksheet rows written by each reviewer or lens)
//   node review-pack.mjs criteria <out.md>
//
// The standard is described in ../standard/review-standard.md; the criteria are in ../standard/criteria.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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

function severityOf(row, findings) {
  if (row.severity) return row.severity;
  const f = row.finding && findings.find((x) => x.id === row.finding);
  return f ? f.severity : undefined;
}

// The most favourable verdict the worksheet allows (rules in severity.md and review-standard.md).
export function verdictCeiling(pack, catalogue) {
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
  return { ceiling, reasons };
}

export function validatePack(pack, catalogue, { stage } = {}) {
  stage = stage || pack.stage || 'submission';
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
    const seen = new Set();
    (pack.worksheet || []).forEach((r, i) => {
      const at = `worksheet[${i}] ${r.id || ''}`.trim();
      const c = known.get(r.id);
      if (!c) return err(at, `Unknown criterion "${r.id}".`);
      if (seen.has(r.id)) err(at, 'Criterion appears twice.');
      seen.add(r.id);
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
      attention.push(`<li><span class="att-head"><a class="fref" href="#c-${esc(c.id)}">${esc(c.id)}</a> ${esc(c.title)} ${result === 'missing' ? '<span class="chip r-missing">No result</span>' : chip(result)}${sevChip(sev)}${r.finding ? ` ${codeLink(r.finding)}` : ''}</span>${what ? `<span class="att-what">${what}</span>` : ''}</li>`);
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
    return `<li class="crit row-${result}" id="c-${esc(c.id)}">
      <div class="crit-id">${esc(c.id)}</div>
      <div class="crit-body"><p class="crit-title">${esc(c.title)} ${tag}</p>
        <p class="crit-std">${fmt(c.standard)}</p>${notes}</div>
      <div class="crit-result">${status}${r.grade ? `<span class="grade" title="${esc(GRADE_WORDS[r.grade] || '')}">Evidence ${esc(r.grade)}: ${esc(GRADE_WORDS[r.grade] || '')}</span>` : ''}${sevChip(sev)}${r.finding ? codeLink(r.finding) : ''}</div>
    </li>`;
  });
  const n = areaCounts(pack, catalogue, code);
  return `<div class="judged">
    ${attention.length ? `<h3>Checklist items that need attention</h3><ul class="attention">${attention.join('')}</ul>` : '<p class="dim">Every checklist item in this area that applies is met.</p>'}
    <details><summary>Full checklist for this area: ${cs.length} items · ${countsText(n)}</summary><ul class="crits">${items.join('')}</ul></details>
  </div>`;
}

function scoreboard(pack, catalogue) {
  return `<div class="score">${catalogue.areas.map((a) => {
    const n = areaCounts(pack, catalogue, a.code);
    const total = Object.values(n).reduce((x, y) => x + y, 0) || 1;
    const seg = (k, label) => (n[k] ? `<span class="seg k-${k}" style="flex-grow:${n[k]}" title="${n[k]} ${label}"></span>` : '');
    return `<a class="score-row" href="#${a.section}">
      <span class="score-name">${esc(a.name)}</span>
      <span class="bar" role="img" aria-label="${countsText(n)}, ${n['not-applicable']} don't apply, out of ${total}">${seg('meets', 'meet')}${seg('does-not-meet', "don't meet")}${seg('cannot-verify', "can't be verified")}${seg('missing', 'without a result')}${seg('not-applicable', "don't apply")}</span>
      <span class="score-n"><b class="t-meets">${n.meets}</b> meet · <b class="t-fails">${n['does-not-meet']}</b> don't · <b class="t-unknown">${n['cannot-verify'] + n.missing}</b> can't verify</span>
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

const SECTIONS = [
  ['verdict', 'Verdict'], ['findings', 'What to fix'], ['product', 'Product'], ['demo', 'Demo'], ['run', 'How to run it'],
  ['requirements', 'Requirements'], ['architecture', 'Architecture'], ['rules', 'Business rules'], ['harness', 'Harness'],
  ['performance', 'Performance'], ['security', 'Security'], ['operations', 'Operations'], ['history', 'Quality history'],
  ['acceptance', 'Acceptance'], ['limits', 'Not checked'], ['glossary', 'Glossary'],
];

export function renderPage(pack, { baseDir = '.', fragment = false, catalogue = loadCatalogue() } = {}) {
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

  const verdictBody = `
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
    ${filled(arch.decisions) ? `<h3>Decisions</h3>${table(['Decision', 'Why', 'Alternatives', 'Downsides'], arch.decisions.map((d) => [fmt(d.title), fmt(d.why), fmt(d.alternatives || ''), fmt(d.downsides || '')]))}` : ''}`;

  const rulesBody = `${notes('D')}${filled(pack.rules) ? table(['ID', 'Rule', 'Enforced by', 'Proved by'], pack.rules.map((r) => [esc(r.id || ''), `<strong>${fmt(r.rule)}</strong>`, fmt(r.enforcedBy), fmt(r.provenBy || '—')])) : ''}`;

  const h = pack.harness || {};
  const harnessBody = `${notes('H')}
    <p><span class="lbl">Agent instructions</span> ${h.agentFile ? `<code>${esc(h.agentFile.path)}</code> ${fmt(h.agentFile.summary || '')}` : '<span class="dim">None: AI coding assistants get no project-specific instructions.</span>'}</p>
    ${filled(h.suites) ? `<h3>Automated tests</h3>${table(['Suite', 'Kind', 'Covers', 'Command', 'Last run', 'Runs automatically on every change'], h.suites.map((s) => [fmt(s.name), fmt(s.kind), fmt(s.covers || ''), `<code>${esc(s.command || '')}</code>`, fmt(s.lastRun || '—'), s.inCI ? 'Yes' : 'No']))}` : ''}
    ${filled(h.ci) ? `<h3>Automatic checks on every change (CI)</h3>${list(h.ci)}` : ''}${filled(h.checks) ? `<h3>Other checks</h3>${list(h.checks)}` : ''}`;

  const perfBody = `${notes('P')}
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

  const body = [
    sec('verdict', 1, 'Verdict', verdictBody),
    sec('findings', 2, 'What to fix', findingsBody),
    sec('product', 3, 'Product', productBody),
    sec('demo', 4, 'Demo: the main journeys', demoBody),
    sec('run', 5, 'How to run it', runBody, 'R'),
    sec('requirements', 6, 'Requirements: the agreed standard', reqBody),
    sec('architecture', 7, 'Architecture', archBody, 'A'),
    sec('rules', 8, 'Business rules', rulesBody, 'D'),
    sec('harness', 9, 'Harness: tests, automatic checks and AI-agent instructions', harnessBody, 'H'),
    sec('performance', 10, 'Performance', perfBody, 'P'),
    sec('security', 11, 'Security', notes('S'), 'S'),
    sec('operations', 12, 'Operations', notes('O'), 'O'),
    sec('history', 13, 'Quality history: problems that keep coming back', histBody, 'Q'),
    sec('acceptance', 14, 'Acceptance', accBody, 'U'),
    sec('limits', 15, 'Not checked', filled(pack.notChecked) ? list(pack.notChecked) : '<p class="dim">Nothing listed.</p>'),
    sec('glossary', 16, 'Glossary', filled(glossary) ? `<dl class="gloss">${glossary.map((g) => `<dt>${fmt(g.term)}</dt><dd>${fmt(g.meaning)}</dd>`).join('')}</dl>` : '<p class="dim">No terms listed.</p>'),
  ].join('\n');

  const nav = `<nav class="toc" aria-label="Sections"><p class="toc-title">Contents</p><ol>${SECTIONS.map(([id, label]) => {
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
    <p class="kicker">Review page${reviewed ? '' : ' · submitted, awaiting review'}</p>
    <h1>${esc(p.name || 'Untitled project')}</h1>
    <p class="meta">${reviewed ? `Reviewed ${esc(p.reviewedOn || '—')} by ${fmt(p.reviewer || '—')}` : `Submitted ${esc(p.date || '—')} by ${fmt(p.author || '—')}`}</p>
    <p class="guide">Owners: section 1 says whether you can launch and what has to happen first. Developers: section 2 lists what to fix; the rest is the evidence.</p>
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

// The README's nine items (standard §1.1), found by their labels as bold text or headings.
export const README_ITEMS = ['What it is', 'Review page', 'Quick start', 'Test access', 'Tests', 'Settings', 'Architecture', 'Known problems', 'For AI agents'];

export function readmeItems(text) {
  const has = (label) => new RegExp(`(^|\\n)\\s*(#{1,6}\\s*|\\*\\*|__)${label.replace(/ /g, '\\s+')}\\b`, 'i').test(text);
  return { present: README_ITEMS.filter(has), missing: README_ITEMS.filter((l) => !has(l)), linksPage: /review\/index\.html/.test(text) };
}

export function gate(stage, pack, catalogue, { baseDir = '.', areas, readme } = {}) {
  const checks = [];
  const add = (name, expected, found, missing = []) => checks.push({ name, expected, found, missing, ok: found === expected && missing.length === 0 });
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
      const ids = catalogue.criteria.filter((c) => c.id.startsWith(code + '-') && applicability(c, pack.project) === 'mandatory').map((c) => c.id);
      const done = ids.filter((id) => RESULTS[rows.get(id)?.result]);
      add(`${code}: mandatory criteria with a result`, ids.length, done.length, ids.filter((id) => !done.includes(id)));
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
  }
  return { ok: checks.every((c) => c.ok), checks };
}

// ---------- template and criteria list ----------

export function templatePack(catalogue, { tier = 2, features = [] } = {}) {
  const project = { name: 'TODO', summary: 'TODO: what it does and for whom, in plain words', repository: 'TODO', commit: 'TODO', date: 'TODO', author: 'TODO', riskTier: tier, riskReason: 'TODO', features, reviewer: '', reviewedOn: '' };
  return {
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
    performance: {},
    history: { period: '', sources: [], stats: [], classes: [], hotspots: [], known: [] },
    acceptance: { criteriaVersion: 'TODO', agreedBy: 'TODO', run: '', rows: [{ id: 'AC-01', priority: 'Must', criterion: 'TODO', status: 'not-run', evidence: [] }] },
    areaNotes: {},
    findings: [],
    worksheet: catalogue.criteria
      .filter((c) => applicability(c, project) === 'mandatory')
      .map((c) => ({ id: c.id, result: '', grade: '', evidence: '', note: '', needed: '' })),
    notChecked: [],
    glossary: [],
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
  ];
  for (const a of catalogue.areas) {
    const cs = catalogue.criteria.filter((c) => c.id.startsWith(a.code + '-'));
    lines.push(`## ${a.code}: ${a.name} (${cs.length})`, '', `*${a.question}*`, '', '| ID | Criterion | Standard | Evidence | Mandatory from | Lowest grade |', '|---|---|---|---|---|---|');
    for (const c of cs) {
      const cond = c.when ? `<br>*Only if the product ${c.when.map((w) => catalogue.features[w]).join(' or ')}.*` : '';
      const src = c.source ? `<br>*Source: ${c.source}*` : '';
      lines.push(`| ${c.id} | **${c.title}** | ${c.standard}${cond}${src} | ${c.evidence} | Tier ${c.tier} | ${c.minGrade} |`);
    }
    lines.push('');
  }
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
    writeFileSync(args[0], JSON.stringify(templatePack(catalogue, { tier, features }), null, 2) + '\n');
    console.log(`Wrote ${args[0]}`);
  } else if (cmd === 'gate' && ['submission', 'worksheet', 'review'].includes(args[0]) && args[1]) {
    const pack = JSON.parse(readFileSync(args[1], 'utf8'));
    const areas = (arg(args, '--areas', '') || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    const result = gate(args[0], pack, catalogue, { baseDir: dirname(resolve(args[1])), areas, readme: arg(args, '--readme') });
    for (const c of result.checks) {
      console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}: expected ${c.expected}, found ${c.found}`);
      for (const m of c.missing.slice(0, 40)) console.log(`        missing: ${m}`);
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
    const lists = args.slice(1).map((f) => { const d = JSON.parse(readFileSync(f, 'utf8')); return Array.isArray(d) ? d : d.worksheet || []; });
    writeFileSync(args[0], JSON.stringify(mergeWorksheet(pack, lists), null, 2) + '\n');
    console.log(`Merged ${lists.reduce((n, l) => n + l.length, 0)} rows into ${args[0]}`);
  } else if (cmd === 'criteria' && args[0]) {
    writeFileSync(args[0], criteriaMarkdown(catalogue) + '\n');
    console.log(`Wrote ${args[0]}`);
  } else {
    console.error('Usage:\n  review-pack.mjs validate <pack.json> [--stage submission|review]\n  review-pack.mjs gate <submission|worksheet|review> <pack.json> [--areas S,A]\n  review-pack.mjs render <pack.json> <out.html> [--fragment]\n  review-pack.mjs template <out.json> [--tier 1|2|3] [--features a,b]\n  review-pack.mjs status <pack.json>\n  review-pack.mjs merge <pack.json> <rows.json>...\n  review-pack.mjs criteria <out.md>');
    process.exit(2);
  }
}
