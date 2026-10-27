#!/usr/bin/env node
// Review pack: check it against the review standard and render it as one self-contained web page.
//
//   node review-pack.mjs validate <pack.json> [--stage submission|review]
//   node review-pack.mjs render   <pack.json> <out.html> [--fragment]
//   node review-pack.mjs template <out.json> [--tier 1|2|3] [--features money,accounts,...]
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

function table(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

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

function criteriaBlock(pack, catalogue, code) {
  const rows = new Map((pack.worksheet || []).map((r) => [r.id, r]));
  const findings = pack.findings || [];
  const items = catalogue.criteria.filter((c) => c.id.startsWith(code + '-')).map((c) => {
    const app = applicability(c, pack.project);
    const r = rows.get(c.id) || {};
    const result = r.result || (app === 'off' ? 'not-applicable' : app === 'mandatory' ? 'missing' : 'optional');
    const sev = r.result === 'does-not-meet' ? severityOf(r, findings) : null;
    const tag = app === 'mandatory' ? 'Mandatory' : app === 'recommended' ? `Recommended (mandatory from tier ${c.tier})` : 'Does not apply to this product';
    const notes = [
      r.evidence ? `<p><span class="lbl">Evidence</span> ${fmt(r.evidence)}</p>` : '',
      r.note ? `<p><span class="lbl">Note</span> ${fmt(r.note)}</p>` : '',
      r.needed ? `<p><span class="lbl">Needed to verify</span> ${fmt(r.needed)}</p>` : '',
      r.owner || r.due ? `<p><span class="lbl">Owner</span> ${fmt(r.owner || '—')} · due ${fmt(r.due || '—')}</p>` : '',
      r.accepted ? `<p><span class="lbl">Risk accepted</span> by ${fmt(r.accepted.by)} until ${fmt(r.accepted.until)}</p>` : '',
      !r.result && app === 'off' ? `<p class="dim">Applies only to products that ${esc(c.when.map((w) => catalogue.features[w]).join(' or '))}.</p>` : '',
    ].join('');
    const status = r.result ? chip(r.result) : `<span class="chip r-${result}">${result === 'missing' ? 'No result' : result === 'optional' ? 'Not assessed' : 'Not applicable'}</span>`;
    return `<li class="crit row-${result}" id="c-${esc(c.id)}">
      <div class="crit-id">${esc(c.id)}</div>
      <div class="crit-body"><p class="crit-title">${esc(c.title)} <span class="tag">${esc(tag)}</span></p>
        <p class="crit-std">${fmt(c.standard)}</p>${notes}</div>
      <div class="crit-result">${status}${r.grade ? `<span class="grade" title="Evidence grade">Grade ${esc(r.grade)}</span>` : ''}${sevChip(sev)}${r.finding ? `<a class="fref" href="#f-${esc(r.finding)}">${esc(r.finding)}</a>` : ''}</div>
    </li>`;
  });
  return `<div class="judged"><h3>How this was judged</h3><ul class="crits">${items.join('')}</ul></div>`;
}

function scoreboard(pack, catalogue) {
  return `<div class="score">${catalogue.areas.map((a) => {
    const n = areaCounts(pack, catalogue, a.code);
    const total = Object.values(n).reduce((x, y) => x + y, 0) || 1;
    const seg = (k, label) => (n[k] ? `<span class="seg k-${k}" style="flex-grow:${n[k]}" title="${n[k]} ${label}"></span>` : '');
    return `<a class="score-row" href="#${a.section}">
      <span class="score-name">${esc(a.name)}</span>
      <span class="bar" role="img" aria-label="${n.meets} meet, ${n['does-not-meet']} do not meet, ${n['cannot-verify']} cannot be verified, ${n.missing} without a result, ${n['not-applicable']} not applicable, out of ${total}">${seg('meets', 'meet')}${seg('does-not-meet', 'do not meet')}${seg('cannot-verify', 'cannot be verified')}${seg('missing', 'without a result')}${seg('not-applicable', 'not applicable')}</span>
      <span class="score-n"><b class="t-meets">${n.meets}</b> · <b class="t-fails">${n['does-not-meet']}</b> · <b class="t-unknown">${n['cannot-verify'] + n.missing}</b></span>
    </a>`;
  }).join('')}<p class="legend"><span><i class="k-meets"></i>Meets</span><span><i class="k-does-not-meet"></i>Does not meet</span><span><i class="k-cannot-verify"></i>Cannot verify or no result</span><span><i class="k-not-applicable"></i>Not applicable</span></p></div>`;
}

const SECTIONS = [
  ['verdict', 'Verdict'], ['product', 'Product'], ['demo', 'Demo'], ['run', 'How to run it'], ['requirements', 'Requirements'],
  ['architecture', 'Architecture'], ['rules', 'Business rules'], ['harness', 'Harness'], ['performance', 'Performance'],
  ['security', 'Security'], ['operations', 'Operations'], ['history', 'Quality history'], ['acceptance', 'Acceptance'],
  ['findings', 'Findings'], ['limits', 'Not checked'], ['glossary', 'Glossary'],
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
  const sec = (id, num, title, body, code) => `<section id="${id}"><header class="sec-head"><span class="sec-num">§${num}</span><h2>${esc(title)}</h2>${code ? `<p class="sec-q">${esc(area(code).question)}</p>` : ''}</header>${body}${code ? criteriaBlock(pack, catalogue, code) : ''}</section>`;
  const notes = (code) => (pack.areaNotes?.[code] ? `<p class="lede">${fmt(pack.areaNotes[code])}</p>` : '');
  const run = pack.run || {};
  const arch = pack.architecture || {};
  const perf = pack.performance || {};
  const hist = pack.history || {};
  const acc = pack.acceptance || {};

  const verdictBody = `
    ${errors.length ? `<div class="incomplete"><p><strong>${reviewed ? 'This review is incomplete' : 'This submission is not reviewable yet'}.</strong> ${errors.length} required item${errors.length > 1 ? 's are' : ' is'} missing or inconsistent:</p><ul>${errors.map((e) => `<li><code>${esc(e.where)}</code> ${esc(e.message)}</li>`).join('')}</ul></div>` : ''}
    <div class="verdict-grid">
      <div class="stamp ${dClass}"><span class="stamp-label">${reviewed ? 'Verdict' : 'Status'}</span><span class="stamp-text">${esc(decision || 'Awaiting review')}</span><span class="stamp-meta">Tier ${esc(p.riskTier)} · ${esc(p.commit || '')}</span></div>
      <div class="verdict-text">${reviewed && v.reason ? `<p class="reason">${fmt(v.reason)}</p>` : `<p class="reason">Submitted by ${fmt(p.author)} for review. The verdict, results and findings are filled in by the reviewer.</p>`}
        ${filled(v.blockers) ? `<h3>Blockers</h3><ol class="todo">${v.blockers.map((b) => `<li>${fmt(b.text)}${(b.refs || []).map((r) => ` <a class="fref" href="#${/^[A-Z]-\d\d$/.test(r) ? 'c-' : 'f-'}${esc(r)}">${esc(r)}</a>`).join('')}</li>`).join('')}</ol>` : ''}
        ${filled(v.conditions) ? `<h3>Conditions</h3><ol class="todo">${v.conditions.map((b) => `<li>${fmt(b.text)}${(b.refs || []).map((r) => ` <a class="fref" href="#${/^[A-Z]-\d\d$/.test(r) ? 'c-' : 'f-'}${esc(r)}">${esc(r)}</a>`).join('')}${b.owner || b.due ? ` <span class="dim">(${fmt(b.owner || 'owner?')}, ${fmt(b.due || 'date?')})</span>` : ''}</li>`).join('')}</ol>` : ''}
      </div>
    </div>
    <h3>Results by area</h3>${scoreboard(pack, catalogue)}
    <p class="toolbar"><button type="button" id="focus-toggle" aria-pressed="false">Show only what needs attention</button></p>
    <p class="signoff">${v.signedBy ? `Signed by <strong>${fmt(v.signedBy)}</strong> on ${fmt(v.signedOn)} for commit <code>${esc(p.commit)}</code>.` : `Not signed yet. Sign-off: name, date and commit <code>${esc(p.commit || '…')}</code>.`}</p>`;

  const productBody = `<p class="lede">${fmt(p.summary)}</p>
    ${pack.product?.users ? `<p><span class="lbl">Users</span> ${fmt(pack.product.users)}</p>` : ''}
    ${filled(pack.product?.outOfScope) ? `<h3>Out of scope</h3>${list(pack.product.outOfScope)}` : ''}
    <p class="dim">Risk tier ${esc(p.riskTier)}${p.riskReason ? `: ${fmt(p.riskReason)}` : ''}</p>
    ${filled(p.features) ? `<p class="feats">${p.features.map((f) => `<span class="feat" title="${esc(catalogue.features[f] || '')}">${esc(catalogue.features[f] || f)}</span>`).join('')}</p>` : ''}`;

  const demoBody = `<div class="journeys">${(pack.product?.journeys || []).map((j) => `<article class="journey" id="j-${esc(j.id || '')}">
      <h3>${j.id ? `<span class="jid">${esc(j.id)}</span> ` : ''}${esc(j.name)}</h3>${j.who ? `<p class="dim">${fmt(j.who)}</p>` : ''}
      <ol class="steps">${(j.steps || []).map((s) => `<li>${fmt(s)}</li>`).join('')}</ol>
      <p><span class="lbl">Expected</span> ${fmt(j.expected)}</p>
      ${evidenceList(j.evidence, baseDir)}
      ${filled(j.criteria) ? `<p class="refs">Proved by ${j.criteria.map((c) => `<a class="fref" href="#a-${esc(c)}">${esc(c)}</a>`).join(' ')}</p>` : ''}
    </article>`).join('')}</div>`;

  const runBody = `${filled(run.prerequisites) ? `<h3>Prerequisites</h3>${list(run.prerequisites)}` : ''}
    <h3>Commands</h3>
    <div class="cmds">${[['Set up', run.setup], ['Start', run.start], ['Open', run.open], ['Test', run.test], ['Reset test data', run.reset]]
      .filter(([, c]) => filled(c)).map(([k, c]) => `<div class="cmd"><span class="lbl">${k}</span>${(Array.isArray(c) ? c : [c]).map((x) => `<pre><code>${esc(x)}</code></pre>`).join('')}</div>`).join('')}</div>
    ${run.staging !== undefined ? `<p><span class="lbl">Staging</span> ${run.staging ? fmt(run.staging) : '<span class="dim">None provided.</span>'}</p>` : ''}
    ${filled(run.accounts) ? `<h3>Test accounts</h3>${table(['Role', 'How to sign in'], run.accounts.map((a) => [fmt(a.role), fmt(a.how)]))}` : ''}
    ${filled(run.settings) ? `<h3>Settings</h3>${table(['Setting', 'What it does', 'Secret', 'Needed in production', 'Example'], run.settings.map((s) => [`<code>${esc(s.name)}</code>`, fmt(s.purpose), s.secret ? 'Yes' : 'No', s.production ? 'Yes' : 'No', s.example ? `<code>${esc(s.example)}</code>` : '']))}` : ''}`;

  const reqBody = filled(pack.requirements) ? table(['ID', 'Requirement', 'Target', 'Agreed by'], pack.requirements.map((r) => [esc(r.id || ''), fmt(r.text), fmt(r.target), `${fmt(r.agreedBy || '—')}${r.agreedOn ? ` <span class="dim">${esc(r.agreedOn)}</span>` : ''}${r.source ? `<br><span class="dim">${fmt(r.source)}</span>` : ''}`])) : '';

  const archBody = `${arch.summary ? `<p class="lede">${fmt(arch.summary)}</p>` : ''}${notes('A')}
    ${arch.diagram ? `<div class="diagram"><pre class="mermaid">${esc(arch.diagram)}</pre></div>` : ''}
    ${filled(arch.components) ? `<h3>Components</h3>${table(['Component', 'Its job', 'Built with'], arch.components.map((c) => [fmt(c.name), fmt(c.job), fmt(c.tech || '')]))}` : ''}
    ${filled(arch.entryPoints) ? `<h3>Entry points</h3>${table(['Entry point', 'Who may call it', 'What stops everyone else', 'What it touches'], arch.entryPoints.map((e) => [fmt(e.entry), fmt(e.caller), fmt(e.guard || ''), fmt(e.touches || '')]))}` : ''}
    ${filled(arch.dataStores) ? `<h3>Data stores</h3>${table(['Store', 'Holds', 'Sensitivity'], arch.dataStores.map((d) => [fmt(d.name), fmt(d.holds), fmt(d.sensitivity || '')]))}` : ''}
    ${filled(arch.services) ? `<h3>Outside services</h3>${table(['Service', 'Used for', 'Time limit', 'When it fails'], arch.services.map((s) => [fmt(s.name), fmt(s.purpose), fmt(s.timeout || '—'), fmt(s.onFailure || '—')]))}` : ''}
    ${filled(arch.decisions) ? `<h3>Decisions</h3>${table(['Decision', 'Why', 'Alternatives', 'Downsides'], arch.decisions.map((d) => [fmt(d.title), fmt(d.why), fmt(d.alternatives || ''), fmt(d.downsides || '')]))}` : ''}`;

  const rulesBody = `${notes('D')}${filled(pack.rules) ? table(['ID', 'Rule', 'Enforced by', 'Proved by'], pack.rules.map((r) => [esc(r.id || ''), `<strong>${fmt(r.rule)}</strong>`, fmt(r.enforcedBy), fmt(r.provenBy || '—')])) : ''}`;

  const h = pack.harness || {};
  const harnessBody = `${notes('H')}
    <p><span class="lbl">Agent instructions</span> ${h.agentFile ? `<code>${esc(h.agentFile.path)}</code> ${fmt(h.agentFile.summary || '')}` : '<span class="dim">None: coding agents get no project-specific instructions.</span>'}</p>
    ${filled(h.suites) ? `<h3>Automated tests</h3>${table(['Suite', 'Kind', 'Covers', 'Command', 'Last run', 'In CI'], h.suites.map((s) => [fmt(s.name), fmt(s.kind), fmt(s.covers || ''), `<code>${esc(s.command || '')}</code>`, fmt(s.lastRun || '—'), s.inCI ? 'Yes' : 'No']))}` : ''}
    ${filled(h.ci) ? `<h3>Continuous integration</h3>${list(h.ci)}` : ''}${filled(h.checks) ? `<h3>Other checks</h3>${list(h.checks)}` : ''}`;

  const perfBody = `${notes('P')}
    ${perf.target ? `<p><span class="lbl">Target</span> ${fmt(perf.target)}</p>` : ''}${perf.environment ? `<p><span class="lbl">Tested on</span> ${fmt(perf.environment)}</p>` : ''}
    ${filled(perf.runs) ? `<h3>Load test runs</h3>${table(['Run', 'Result', 'Notes'], perf.runs.map((r) => [fmt(r.label), `<span class="chip ${r.pass ? 'r-meets' : 'r-does-not-meet'}">${esc(r.result)}</span>`, fmt(r.note || '')]))}` : ''}
    ${filled(perf.steps) ? `<h3>${fmt(perf.stepsTitle || 'Per step')}</h3>${table(['Step', 'Request', 'Target', 'Achieved', 'p95 (budget)', 'Errors', 'Result'], perf.steps.map((s) => [fmt(s.step), fmt(s.endpoint), fmt(s.target), fmt(s.achieved), fmt(s.p95), fmt(s.errors), `<span class="chip ${s.pass ? 'r-meets' : 'r-does-not-meet'}">${s.pass ? 'Pass' : 'Fail'}</span>`]))}` : ''}
    ${perf.race ? `<h3>Race test</h3><p>${fmt(perf.race.summary)}</p>${filled(perf.race.rows) ? table(['Measure', 'Value'], perf.race.rows.map((r) => [fmt(r.measure), `<span class="num">${fmt(r.value)}</span>`])) : ''}` : ''}
    ${perf.slowPartner ? `<h3>Slow partner</h3><p>${fmt(perf.slowPartner)}</p>` : ''}
    ${perf.conclusion ? `<p class="callout">${fmt(perf.conclusion)}</p>` : ''}`;

  const histBody = `${notes('Q')}
    ${hist.period ? `<p><span class="lbl">Period</span> ${fmt(hist.period)}</p>` : ''}${filled(hist.sources) ? `<p><span class="lbl">Sources</span></p>${list(hist.sources)}` : ''}
    ${filled(hist.stats) ? `<div class="stats">${hist.stats.map((s) => `<div class="stat"><span class="stat-v">${fmt(s.value)}</span><span class="stat-l">${fmt(s.label)}</span></div>`).join('')}</div>` : ''}
    ${filled(hist.classes) ? `<h3>Recurring problems</h3><div class="classes">${hist.classes.map((c) => `<article class="pclass">
        <header><h4>${fmt(c.name)}</h4><span class="chip ${c.status === 'controlled' ? 'r-meets' : c.status === 'partly controlled' ? 'r-cannot-verify' : 'r-does-not-meet'}">${esc(c.status || 'open')}</span></header>
        <p class="occ-n">${(c.occurrences || []).length} occurrences</p>
        <ul class="occ">${(c.occurrences || []).map((o) => `<li><span class="oref">${fmt(o.ref)}</span> ${fmt(o.text)}</li>`).join('')}</ul>
        <p><span class="lbl">Root cause</span> ${fmt(c.rootCause)}</p>
        <p><span class="lbl">Control</span> ${fmt(c.control)}</p>
        ${c.controlCheck ? `<p><span class="lbl">Control checked</span> ${fmt(c.controlCheck)}</p>` : ''}
        ${c.agentRule ? `<p><span class="lbl">Agent rule</span> ${fmt(c.agentRule)}</p>` : ''}
      </article>`).join('')}</div>` : ''}
    ${filled(hist.hotspots) ? `<h3>Hotspots</h3>${table(['File', 'Fixes', 'Note'], hist.hotspots.map((x) => [`<code>${esc(x.file)}</code>`, `<span class="num">${esc(x.fixes)}</span>`, fmt(x.note || '')]))}` : ''}
    <h3>Known problems register</h3>${filled(hist.known) ? table(['ID', 'Problem', 'Severity', 'Owner', 'Due', 'Status'], hist.known.map((k) => [esc(k.id || ''), fmt(k.text), sevChip(k.severity), fmt(k.owner || '—'), fmt(k.due || '—'), fmt(k.status || 'Open')])) : '<p class="dim">No known problems declared.</p>'}`;

  const accBody = `${notes('U')}
    ${acc.criteriaVersion ? `<p><span class="lbl">Criteria</span> version ${fmt(acc.criteriaVersion)}${acc.agreedBy ? `, agreed by ${fmt(acc.agreedBy)}` : ''}${acc.run ? `. ${fmt(acc.run)}` : ''}</p>` : ''}
    ${filled(acc.rows) ? `<ul class="acc">${acc.rows.map((r) => `<li id="a-${esc(r.id)}" class="acc-row">
        <div class="acc-head"><span class="crit-id">${esc(r.id)}</span><span class="prio">${esc(r.priority || '')}</span><span class="acc-c">${fmt(r.criterion)}</span>
        <span class="chip ${r.status === 'pass' ? 'r-meets' : r.status === 'fail' || r.status === 'flaky' ? 'r-does-not-meet' : r.status === 'external' ? 'r-not-applicable' : 'r-cannot-verify'}">${esc({ pass: 'Pass', fail: 'Fail', flaky: 'Flaky', external: 'Checked elsewhere', 'not-run': 'Not run' }[r.status] || r.status || 'Not run')}${r.runs ? ` ${esc(r.runs)}` : ''}</span></div>
        ${r.note ? `<p class="dim">${fmt(r.note)}</p>` : ''}${evidenceList(r.evidence, baseDir, { thumbs: true })}</li>`).join('')}</ul>` : ''}`;

  const findingsBody = filled(pack.findings) ? `<ul class="findings">${pack.findings.map((f) => `<li id="f-${esc(f.id)}" class="finding">
      <div class="f-head"><span class="crit-id">${esc(f.id)}</span>${sevChip(f.severity)}<span class="f-status">${fmt(f.status || 'Open')}${f.confidence ? ` · ${fmt(f.confidence)}` : ''}</span></div>
      <p class="f-title">${fmt(f.title)}</p>
      ${f.impact ? `<p><span class="lbl">Impact</span> ${fmt(f.impact)}</p>` : ''}${f.where ? `<p><span class="lbl">Where</span> ${fmt(f.where)}</p>` : ''}${f.fix ? `<p><span class="lbl">Fix</span> ${fmt(f.fix)}</p>` : ''}
    </li>`).join('')}</ul>` : '<p class="dim">No findings recorded.</p>';

  const body = [
    sec('verdict', 1, 'Verdict', verdictBody),
    sec('product', 2, 'Product', productBody),
    sec('demo', 3, 'Demo: the main journeys', demoBody),
    sec('run', 4, 'How to run it', runBody, 'R'),
    sec('requirements', 5, 'Requirements: the agreed standard', reqBody),
    sec('architecture', 6, 'Architecture', archBody, 'A'),
    sec('rules', 7, 'Business rules', rulesBody, 'D'),
    sec('harness', 8, 'Harness: tests, CI and agent instructions', harnessBody, 'H'),
    sec('performance', 9, 'Performance', perfBody, 'P'),
    sec('security', 10, 'Security', notes('S'), 'S'),
    sec('operations', 11, 'Operations', notes('O'), 'O'),
    sec('history', 12, 'Quality history: known and recurring problems', histBody, 'Q'),
    sec('acceptance', 13, 'Acceptance', accBody, 'U'),
    sec('findings', 14, 'Findings', findingsBody),
    sec('limits', 15, 'Not checked', filled(pack.notChecked) ? list(pack.notChecked) : '<p class="dim">Nothing listed.</p>'),
    sec('glossary', 16, 'Glossary', filled(pack.glossary) ? `<dl class="gloss">${pack.glossary.map((g) => `<dt>${fmt(g.term)}</dt><dd>${fmt(g.meaning)}</dd>`).join('')}</dl>` : '<p class="dim">No terms listed.</p>'),
  ].join('\n');

  const nav = `<nav class="toc" aria-label="Sections"><p class="toc-title">Contents</p><ol>${SECTIONS.map(([id, label]) => {
    const a = catalogue.areas.find((x) => x.section === id);
    let dot = '';
    if (a) {
      const n = areaCounts(pack, catalogue, a.code);
      const state = n['does-not-meet'] ? 'fails' : n['cannot-verify'] + n.missing ? 'unknown' : 'meets';
      dot = `<i class="dot d-${state}" aria-hidden="true"></i>`;
    }
    return `<li><a href="#${id}">${esc(label)}${dot}</a></li>`;
  }).join('')}</ol></nav>`;

  const title = `${p.name || 'Untitled'} review`;
  const page = `<title>${esc(title)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..100,500..800&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>${CSS}</style>
<div class="page">
  <header class="masthead">
    <p class="kicker">Review pack · standard ${esc(pack.standard || catalogue.standard)} · ${reviewed ? 'reviewed' : 'submitted'}</p>
    <h1>${esc(p.name || 'Untitled project')}</h1>
    <p class="meta"><span>Commit <code>${esc(p.commit || '—')}</code></span><span>Submitted ${esc(p.date || '—')} by ${fmt(p.author || '—')}</span>${reviewed ? `<span>Reviewed ${esc(p.reviewedOn || '—')} by ${fmt(p.reviewer || '—')}</span>` : ''}${p.repository ? `<span>${fmt(p.repository)}</span>` : ''}</p>
  </header>
  <div class="layout">${nav}<main>${body}</main></div>
  <footer class="foot">Generated by <code>review-pack.mjs</code> from <code>review-pack.json</code>. The JSON file is the record; this page is a view of it.</footer>
</div>
<dialog id="zoom-dialog"><button type="button" class="close" aria-label="Close">Close</button><img alt=""></dialog>
<script>${SCRIPT}</script>
${fragment ? '' : '<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script><script>window.mermaid && mermaid.initialize({ startOnLoad: true, theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "neutral" });</script>'}`;
  return fragment ? page : `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${page.replace('<div class="page">', '</head>\n<body>\n<div class="page">')}\n</body>\n</html>\n`;
}

const SCRIPT = `
(function () {
  var btn = document.getElementById('focus-toggle');
  function set(on) { document.body.classList.toggle('focus', on); if (btn) { btn.setAttribute('aria-pressed', String(on)); btn.textContent = on ? 'Show everything' : 'Show only what needs attention'; } }
  try { set(localStorage.getItem('review-focus') === '1'); } catch (e) {}
  if (btn) btn.addEventListener('click', function () { var on = !document.body.classList.contains('focus'); set(on); try { localStorage.setItem('review-focus', on ? '1' : '0'); } catch (e) {} });
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
.toc a::before { content: "§" counter(s); font: 12px var(--mono); color: var(--muted); min-width: 26px; }
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
.score-row { display: grid; grid-template-columns: minmax(120px, 190px) minmax(0, 1fr) 92px; gap: 12px; align-items: center; color: var(--ink); text-decoration: none; padding: 3px 0; }
.score-row:hover .score-name { text-decoration: underline; }
.score-name { font-weight: 500; }
.bar { display: flex; height: 12px; border-radius: 3px; overflow: hidden; background: var(--na-bg); gap: 2px; }
.seg { display: block; min-width: 4px; }
.k-meets { background: var(--meets); } .k-does-not-meet { background: var(--fails); } .k-cannot-verify, .k-missing { background: var(--unknown); } .k-not-applicable { background: var(--na-bg); outline: 1px solid var(--line); outline-offset: -1px; }
.score-n { font: 13px var(--mono); font-variant-numeric: tabular-nums; text-align: right; }
.t-meets { color: var(--meets); } .t-fails { color: var(--fails); } .t-unknown { color: var(--unknown); }
.legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 12.5px; color: var(--muted); }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
.toolbar button { font: 500 13.5px var(--body); color: var(--ink); background: var(--paper); border: 1px solid var(--line); border-radius: 5px; padding: 6px 12px; cursor: pointer; }
.toolbar button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
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
body.focus .row-meets, body.focus .row-not-applicable, body.focus .row-optional { display: none; }
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
  .score-row { grid-template-columns: minmax(0, 1fr) 84px; }
  .score-row .bar { grid-column: 1 / -1; grid-row: 2; }
  .crit { grid-template-columns: 44px minmax(0, 1fr); }
  .crit-result { grid-column: 2; flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: flex-start; }
  .acc-head { grid-template-columns: 48px minmax(0, 1fr); }
  .acc-head .prio { display: none; }
  .acc-head .chip { grid-column: 2; justify-self: start; }
  .gloss { grid-template-columns: minmax(0, 1fr); }
}
`;

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
  } else if (cmd === 'criteria' && args[0]) {
    writeFileSync(args[0], criteriaMarkdown(catalogue) + '\n');
    console.log(`Wrote ${args[0]}`);
  } else {
    console.error('Usage:\n  review-pack.mjs validate <pack.json> [--stage submission|review]\n  review-pack.mjs render <pack.json> <out.html> [--fragment]\n  review-pack.mjs template <out.json> [--tier 1|2|3] [--features a,b]\n  review-pack.mjs criteria <out.md>');
    process.exit(2);
  }
}
