#!/usr/bin/env node
// Collect a project's defect history from git (and optionally an issue export) and group it into
// problem classes, so recurring problems and their hotspots stand out.
//
//   node history-scan.mjs <repo-dir> <out-dir> [--since 2025-01-01] [--path src/] [--issues issues.json] [--all-files]
//
// Hotspots count code files only; --all-files includes documentation and data files too.
//
// issues.json: an array of { number, title, body, labels, state, createdAt, closedAt }, for example from
//   gh issue list --state all --limit 1000 --json number,title,body,labels,state,createdAt,closedAt
// Labels may be strings or { name } objects.
//
// Output: <out-dir>/history.md (for people) and <out-dir>/history.json (for the review pack).
// The classes come from keywords, so they are leads: read the commits behind each class before naming a root cause.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIX = /\b(fix(e[sd])?|bug(fix)?|hotfix|patch(ed)?|regression|broken|crash(e[sd])?|repair(ed)?|resolve[sd]?|incident|workaround|revert(s|ed)?)\b|^fix(\(.+\))?!?:/i;
export const REVERT = /^revert\b|this reverts commit/i;
export const AI_TRAILER = /co-authored-by:.*\b(claude|copilot|cursor|codex|gemini|aider|devin|openai|anthropic)\b|generated (with|by) .*\b(claude|copilot|cursor|codex|gemini|chatgpt)\b/i;

// Problem classes, in the order they are reported. A defect can fall into several.
export const CLASSES = [
  { key: 'input', name: 'Bad input and crashes', re: /\b(crash\w*|malformed|invalid|validat\w*|pars(e|es|ed|ing|er)|null|undefined|nan|exception|unhandled|500|bad request|sanitis\w*|sanitiz\w*|encoding|escap\w*)\b/i },
  { key: 'concurrency', name: 'Concurrency, duplicates and double actions', re: /\b(race|concurren\w*|double|duplicat\w*|idempoten\w*|oversell\w*|oversold|sold more|more than (we had|in stock)|deadlock|lock(s|ing)?|atomic\w*|twice|in parallel|simultaneous)\b/i },
  { key: 'external', name: 'Outside services, time-outs and retries', re: /\b(time-?outs?|timed out|hang(s|ing)?|slow (payment|provider|api|response)|provider|webhooks?|third[- ]party|upstream|retr(y|ies|ied)|backoff|network|unreachable|charged but|spins?|spinning)\b/i },
  { key: 'access', name: 'Access control, sign-in and secrets', re: /\b(auth\w*|permission\w*|access control|unauthori[sz]ed|forbidden|role|idor|secret\w*|tokens?|password\w*|csrf|xss|injection|cors|session\w*|login|sign[- ]?in|security|vulnerab\w*|cve-\d+)\b/i },
  { key: 'config', name: 'Configuration, start-up and deploys', re: /\b(config\w*|env(ironment)?( var(iable)?s?)?|settings?|feature flags?|start-?up|restart\w*|boot|deploy\w*|migrations?|schema|rollback|roll back|production mode|\.env)\b/i },
  { key: 'data', name: 'Wrong data and calculations', re: /\b(wrong|incorrect|totals?|prices?|amounts?|round(ing)?|currenc\w*|time ?zones?|dates?|stock|inventory|balances?|calculat\w*|mismatch\w*|inconsisten\w*|off[- ]by[- ]one|precision)\b/i },
  { key: 'performance', name: 'Performance and resources', re: /\b(perf\w*|slow(ness)?|memory|leaks?|n\+1|cach\w*|latency|cpu|throughput|pool|overload\w*|scal(e|ing))\b/i },
  // Only words about how things look: "page" and "button" appear in almost every ticket and would pull everything in here.
  { key: 'ui', name: 'Screens and display', re: /\b(ui|ux|css|layout|display\w*|render\w*|mobile|phone|style\w*|modal|dark mode|responsive|accessib\w*|a11y|visible|invisible|hidden|overlap\w*|disappear\w*|go(es)? away|still show\w*|misaligned|cut off|font)\b/i },
  { key: 'tests', name: 'Tests, tooling and CI', re: /\b(flak(y|iness)|tests?|ci|lint\w*|build|type ?check\w*|types?|compile\w*|tooling)\b/i },
];

export function classify(text) {
  const hits = CLASSES.filter((c) => c.re.test(text)).map((c) => c.key);
  return hits.length ? hits : ['other'];
}

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

export function readCommits(dir, { since, path } = {}) {
  const args = ['log', '--no-merges', '--date=short', '--format=%x1e%H%x1f%ad%x1f%an%x1f%s%x1f%b%x1f', '--name-only'];
  if (since) args.push(`--since=${since}`);
  if (path) args.push('--', path);
  return git(dir, args).split('\x1e').filter((s) => s.trim()).map((rec) => {
    const [hash, date, author, subject, body, files] = rec.split('\x1f');
    return {
      hash: hash.trim(), short: hash.trim().slice(0, 7), date, author, subject: subject.trim(), body: (body || '').trim(),
      files: (files || '').split('\n').map((f) => f.trim()).filter(Boolean),
    };
  });
}

const labelNames = (labels) => (labels || []).map((l) => (typeof l === 'string' ? l : l.name || '')).filter(Boolean);
// A ticket is a defect lead unless it is plainly a request: security, performance, display and outage tickets are defects too.
const DEFECT_LABEL = /bug|defect|incident|regression|crash|outage|security|vulnerab|perf|ui|ux|a11y|accessib|payment|stock|data/i;
const REQUEST_LABEL = /enhancement|feature|request|question|doc|chore|idea|proposal/i;
const isBugIssue = (i) => {
  const labels = labelNames(i.labels);
  if (labels.some((l) => DEFECT_LABEL.test(l))) return true;
  if (labels.some((l) => REQUEST_LABEL.test(l))) return false;
  return /\b(bug|crash(es|ed)?|broken|error|fails?|failed|wrong|regression|charged|lost|missing|slow|down|can't|cannot|doesn't|won't|again)\b/i.test(`${i.title || ''} ${i.body || ''}`);
};

// Hotspots count code, not documentation or reports, unless allFiles is set.
export const CODE_FILE = /\.(m?[jt]sx?|cjs|py|rb|go|java|kt|cs|php|rs|swift|scala|sql|vue|svelte|css|scss|html?|sh|ya?ml|toml|tf|prisma|graphql|gql|rules)$|(^|\/)(Dockerfile|Procfile|Makefile)$/i;

export function analyse(commits, issues = [], { allFiles = false } = {}) {
  const fixes = commits.filter((c) => FIX.test(c.subject) || FIX.test(c.body.split('\n')[0] || ''));
  const reverts = commits.filter((c) => REVERT.test(c.subject) || REVERT.test(c.body));
  const aiAssisted = commits.filter((c) => AI_TRAILER.test(c.body));
  const bugIssues = issues.filter(isBugIssue);

  const classes = new Map([...CLASSES.map((c) => [c.key, c.name]), ['other', 'Other']].map(([k, n]) => [k, { key: k, name: n, commits: [], issues: [] }]));
  for (const c of fixes) for (const k of classify(`${c.subject}\n${c.body}`)) classes.get(k).commits.push(c);
  for (const i of bugIssues) for (const k of classify(`${i.title}\n${i.body || ''}\n${labelNames(i.labels).join(' ')}`)) classes.get(k).issues.push(i);

  const fileFixes = new Map();
  for (const c of fixes) for (const f of c.files) {
    if (!allFiles && !CODE_FILE.test(f)) continue;
    if (!fileFixes.has(f)) fileFixes.set(f, []);
    fileFixes.get(f).push(c);
  }
  const churn = new Map();
  for (const c of commits) for (const f of c.files) churn.set(f, (churn.get(f) || 0) + 1);
  const hotspots = [...fileFixes.entries()]
    .map(([file, cs]) => ({ file, fixes: cs.length, changes: churn.get(file) || 0, last: cs[0].date, commits: cs.map((c) => c.short) }))
    .sort((a, b) => b.fixes - a.fixes || b.changes - a.changes)
    .slice(0, 15);
  const repeated = hotspots.filter((h) => h.fixes >= 2);

  // Many unrelated files in one fix commit make the history hard to read: one fix per commit, with its test, is the habit to build.
  const bundled = fixes.filter((c) => c.files.length > 10).map((c) => ({ ref: c.short, date: c.date, text: c.subject, files: c.files.length }));

  // A few commits and no bug reports can't show what keeps coming back. Say so rather than read meaning into nothing.
  const thin = fixes.length + bugIssues.length < 3;

  return {
    thin,
    totals: { commits: commits.length, fixes: fixes.length, reverts: reverts.length, aiAssisted: aiAssisted.length, issues: issues.length, bugIssues: bugIssues.length, bundledFixes: bundled.length },
    bundled,
    first: commits.length ? commits[commits.length - 1].date : null,
    last: commits.length ? commits[0].date : null,
    classes: [...classes.values()]
      .map((c) => ({ key: c.key, name: c.name, count: c.commits.length + c.issues.length, recurring: c.commits.length + c.issues.length >= 2, commits: c.commits.map((x) => ({ ref: x.short, date: x.date, text: x.subject })), issues: c.issues.map((x) => ({ ref: `#${x.number}`, date: (x.createdAt || '').slice(0, 10), text: x.title, state: x.state })) }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count),
    hotspots,
    repeated,
    reverts: reverts.map((c) => ({ ref: c.short, date: c.date, text: c.subject })),
  };
}

export function toMarkdown(result, { repo, since, path }) {
  const t = result.totals;
  const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '0%');
  const lines = [
    '# Defect history',
    '',
    `Repository \`${repo}\`${path ? `, path \`${path}\`` : ''}${since ? `, since ${since}` : ''}. Commits from ${result.first || '—'} to ${result.last || '—'}.`,
    '',
    '| Measure | Value |',
    '|---|---|',
    `| Commits (merges excluded) | ${t.commits} |`,
    `| Fix commits | ${t.fixes} (${pct(t.fixes, t.commits)}) |`,
    `| Reverts | ${t.reverts} |`,
    `| Commits with an AI co-author or "generated with" trailer | ${t.aiAssisted} (${pct(t.aiAssisted, t.commits)}) |`,
    `| Issues read / bug-like | ${t.issues} / ${t.bugIssues} |`,
    `| Fix commits touching more than 10 files | ${t.bundledFixes} |`,
    '',
    ...(result.thin ? [`**Too little history to learn from:** ${t.commits} commit(s), ${t.fixes} fix commit(s) and ${t.bugIssues} bug-like issue(s). Say so in Quality history rather than reading meaning into it, and use what else exists: earlier review reports, incident notes, support tickets, the issue tracker. With none, the recurring problems are judged from this review's own findings.`, ''] : []),
    '**These are leads, not conclusions.** Classes come from keywords in commit messages and issue titles. Before naming a root cause, read the changes behind each recurring class.',
    ...(t.bundledFixes ? ['', `**${t.bundledFixes} fix commit(s) bundle many changes**, so their keywords land in several classes at once. Use review reports or issues as the defect record for those, and prefer one fix per commit, with its test.`] : []),
    '',
    '## Problem classes',
    '',
  ];
  if (!result.classes.length) lines.push('No fix commits or bug issues found.', '');
  for (const c of result.classes) {
    lines.push(`### ${c.name}: ${c.count}${c.recurring ? ' (recurring)' : ''}`, '');
    for (const x of c.commits.slice(0, 12)) lines.push(`- \`${x.ref}\` ${x.date} ${x.text}`);
    for (const x of c.issues.slice(0, 12)) lines.push(`- issue ${x.ref} ${x.date} ${x.text} (${x.state || 'unknown'})`);
    const more = c.commits.length - 12 + Math.max(0, c.issues.length - 12);
    if (more > 0) lines.push(`- …and ${more} more`);
    lines.push('');
  }
  lines.push('## Hotspots: code files touched by the most fixes', '');
  if (!result.hotspots.length) lines.push('None.', '');
  else {
    lines.push('| File | Fixes | All changes | Last fix | Fix commits |', '|---|---|---|---|---|');
    for (const h of result.hotspots) lines.push(`| \`${h.file}\` | ${h.fixes} | ${h.changes} | ${h.last} | ${h.commits.slice(0, 6).map((c) => `\`${c}\``).join(' ')} |`);
    lines.push('');
  }
  lines.push('## Reverts', '');
  lines.push(...(result.reverts.length ? result.reverts.map((r) => `- \`${r.ref}\` ${r.date} ${r.text}`) : ['None.']), '');
  lines.push('## Next steps for the reviewer', '',
    '1. For each recurring class, read the diffs and name the root cause: why does this keep happening (a design gap, a missing test type, an unclear rule), not what the last bug was.',
    '2. For each root cause, find or add a control that would catch the next one automatically (test, code-scanning rule, constraint, CI gate), and run it against a past example to prove it works.',
    '3. Add a one-line rule to the agent instruction file (AGENTS.md or CLAUDE.md) that points to the control.',
    '4. Review the top hotspots in depth.', '');
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const [repo, out] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
  if (!repo || !out) {
    console.error('Usage: history-scan.mjs <repo-dir> <out-dir> [--since YYYY-MM-DD] [--path sub/dir] [--issues issues.json]');
    process.exit(2);
  }
  const since = opt('--since');
  const path = opt('--path');
  const issues = opt('--issues') ? JSON.parse(readFileSync(opt('--issues'), 'utf8')) : [];
  const result = analyse(readCommits(repo, { since, path }), issues, { allFiles: args.includes('--all-files') });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'history.json'), JSON.stringify(result, null, 2) + '\n');
  writeFileSync(join(out, 'history.md'), toMarkdown(result, { repo, since, path }));
  const t = result.totals;
  console.log(`${t.commits} commits, ${t.fixes} fixes, ${t.reverts} reverts, ${t.bugIssues} bug-like issues; ${result.classes.filter((c) => c.recurring).length} recurring classes. Wrote ${join(out, 'history.md')}`);
  if (result.thin) console.log('Too little history to learn from: say so in Quality history and use review reports, incidents and issues instead.');
}
