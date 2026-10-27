#!/usr/bin/env node
// Static check of database access rules in the project's files:
//  - Supabase / Postgres: tables in the public schema without Row Level Security, RLS
//    switched off, and write policies that allow everything (USING (true)).
//  - Firebase: Firestore / Storage / Realtime Database rules that are open or in "test mode".
//
//   node check-data-access-rules.mjs <project-dir> [out.json]
//
// This only sees what's in the repo. The live database can differ, so also check it
// directly (Supabase dashboard → Advisors → Security Advisor; Firebase console → Rules).
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.venv', 'venv', 'vendor', 'coverage', 'launch-review']);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), files);
    } else files.push(path.join(dir, entry.name));
  }
  return files;
}

const stripSqlComments = (sql) => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const normName = (raw) => {
  const parts = raw.replace(/"/g, '').toLowerCase().split('.');
  return parts.length === 2 ? { schema: parts[0], table: parts[1] } : { schema: 'public', table: parts[0] };
};
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

export function checkSql(files, root) {
  const tables = new Map(); // "schema.table" -> { file, line }
  const rlsEnabled = new Set();
  const rlsDisabled = new Set();
  const findings = [];
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const sql = stripSqlComments(raw);
    const rel = path.relative(root, file);
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?((?:"?[\w]+"?\.)?"?[\w]+"?)/gi)) {
      const { schema, table } = normName(m[1]);
      tables.set(`${schema}.${table}`, { file: rel, line: lineOf(sql, m.index) });
    }
    for (const m of sql.matchAll(/alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?((?:"?[\w]+"?\.)?"?[\w]+"?)\s+(enable|disable)\s+row\s+level\s+security/gi)) {
      const { schema, table } = normName(m[1]);
      const key = `${schema}.${table}`;
      if (m[2].toLowerCase() === 'enable') rlsEnabled.add(key);
      else {
        rlsEnabled.delete(key);
        rlsDisabled.add(key);
        findings.push({
          severity: 'Critical', rule: 'rls-disabled', file: rel, line: lineOf(sql, m.index), table: key,
          issue: `Row Level Security is switched OFF for ${key}. Anyone with the public (anon) key can read and change every row.`,
        });
      }
    }
    for (const statement of sql.split(';')) {
      const policy = statement.match(/create\s+policy\s+("[^"]+"|\w+)\s+on\s+((?:"?[\w]+"?\.)?"?[\w]+"?)([\s\S]*)/i);
      if (!policy) continue;
      const { schema, table } = normName(policy[2]);
      const rest = policy[3].toLowerCase();
      const command = (rest.match(/\bfor\s+(all|select|insert|update|delete)\b/) ?? [, 'all'])[1];
      const roles = (rest.match(/\bto\s+([\w\s,]+?)(?=\s+using|\s+with|\s*$)/) ?? [, 'public'])[1].trim();
      const usingTrue = /using\s*\(\s*true\s*\)/.test(rest);
      const checkTrue = /with\s+check\s*\(\s*true\s*\)/.test(rest);
      const where = { file: path.relative(root, file), line: lineOf(sql, sql.indexOf(statement.trim())), table: `${schema}.${table}` };
      if (command !== 'select' && (usingTrue || checkTrue)) {
        findings.push({
          severity: 'Critical', rule: 'policy-allows-any-row', ...where,
          issue: `Policy ${policy[1]} lets ${roles} ${command.toUpperCase()} any row of ${schema}.${table} (condition is "true"). Restrict it to the row owner, e.g. USING (auth.uid() = user_id).`,
        });
      } else if (command === 'select' && usingTrue && /\b(anon|public)\b/.test(roles)) {
        findings.push({
          severity: 'Review', rule: 'public-read-policy', ...where,
          issue: `${schema}.${table} is readable by everyone, including logged-out visitors. Fine for public catalogue data; a data leak if it holds personal or order data.`,
        });
      }
    }
  }
  for (const [key, where] of tables) {
    if (key.startsWith('public.') && !rlsEnabled.has(key) && !rlsDisabled.has(key)) {
      findings.push({
        severity: 'Critical', rule: 'table-without-rls', file: where.file, line: where.line, table: key,
        issue: `Table ${key} is created without "ENABLE ROW LEVEL SECURITY". On Supabase, tables in the public schema are reachable with the public anon key, so anyone can read/modify it unless RLS is on.`,
      });
    }
  }
  return { tables: [...tables.keys()], findings };
}

export function checkFirebase(files, root) {
  const findings = [];
  for (const file of files) {
    const name = path.basename(file);
    const rel = path.relative(root, file);
    const text = fs.readFileSync(file, 'utf8');
    if (/\.rules$/.test(name)) {
      for (const m of text.matchAll(/allow\s+([\w,\s]+?)\s*:\s*if\s+true\s*;/g)) {
        const ops = m[1].trim();
        const readOnly = /^(read|get|list)(\s*,\s*(read|get|list))*$/.test(ops);
        findings.push({
          severity: readOnly ? 'Review' : 'Critical', rule: readOnly ? 'firebase-public-read' : 'firebase-public-write', file: rel, line: lineOf(text, m.index),
          issue: readOnly
            ? `Rule "allow ${ops}: if true": anyone on the internet can read this data. Fine for public content only.`
            : `Rule "allow ${ops}: if true" lets anyone on the internet change this data.`,
        });
      }
      for (const m of text.matchAll(/request\.time\s*<\s*timestamp\.date\(/g)) {
        findings.push({ severity: 'Critical', rule: 'firebase-test-mode', file: rel, line: lineOf(text, m.index), issue: 'Firebase "test mode" rule: the database is open to everyone until the date in the rule, then closes for everyone.' });
      }
    } else if (name === 'database.rules.json') {
      for (const m of text.matchAll(/"\.(read|write)"\s*:\s*(true|"true")/g)) {
        findings.push({ severity: 'Critical', rule: 'realtime-db-open', file: rel, line: lineOf(text, m.index), issue: `Realtime Database "${m[1]}" is open to everyone.` });
      }
    }
  }
  return findings;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const root = path.resolve(process.argv[2] ?? '.');
  const outFile = process.argv[3];
  const files = walk(root);
  const sqlFiles = files.filter((f) => f.endsWith('.sql'));
  const firebaseFiles = files.filter((f) => /\.rules$/.test(f) || path.basename(f) === 'database.rules.json');
  const sql = checkSql(sqlFiles, root);
  const findings = [...sql.findings, ...checkFirebase(firebaseFiles, root)];
  const result = { filesChecked: sqlFiles.length + firebaseFiles.length, sqlFiles: sqlFiles.length, firebaseFiles: firebaseFiles.length, tables: sql.tables, findings };
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n');

  const lines = ['# Database access rules', ''];
  if (result.filesChecked === 0) {
    lines.push('No SQL migrations or Firebase rules files found in the repo. If the app uses Supabase or Firebase, check the live rules in their dashboards (Supabase → Advisors → Security Advisor).');
  } else {
    lines.push(`Checked ${sqlFiles.length} SQL file(s) (${sql.tables.length} tables) and ${firebaseFiles.length} Firebase rules file(s).`, '');
    if (findings.length === 0) lines.push('No open tables or permissive rules found in these files.');
    else {
      lines.push('| Severity | Where | Issue |', '|---|---|---|');
      for (const f of findings) lines.push(`| ${f.severity} | \`${f.file}:${f.line}\` | ${f.issue} |`);
    }
    lines.push('', 'The live database may differ from the files. Confirm in the Supabase/Firebase dashboard.');
  }
  console.log(lines.join('\n'));
}
