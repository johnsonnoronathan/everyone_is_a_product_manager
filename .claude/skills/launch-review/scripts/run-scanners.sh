#!/usr/bin/env bash
# Runs every automated scanner that is installed and records what ran in coverage.md.
#
#   bash run-scanners.sh <project-dir> <output-dir>
#
# Missing tools are skipped (and listed with install hints), never fatal: the review
# continues with whatever evidence is available, and the report says what wasn't checked.
# Set SEMGREP_REGISTRY=1 to also run Semgrep's registry rules (p/default). Those rules are
# under the Semgrep Rules License: only use them in paid client work if you hold a license.
set -uo pipefail
# Semgrep otherwise phones home for a version check, which can hang for minutes behind proxies.
export SEMGREP_ENABLE_VERSION_CHECK=0

project="${1:?usage: run-scanners.sh <project-dir> <output-dir>}"
out="${2:?usage: run-scanners.sh <project-dir> <output-dir>}"
skill_dir="$(cd "$(dirname "$0")/.." && pwd)"
peak_rules="$skill_dir/../peak-traffic-test/semgrep"
project="$(cd "$project" && pwd)"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
coverage="$out/coverage.md"

{
  echo "# Automated scan coverage"
  echo
  echo "- Project: \`$project\`"
  echo "- Commit: \`$(git -C "$project" rev-parse --short HEAD 2>/dev/null || echo 'not a git repo')\`"
  echo "- Date (UTC): $(date -u +%Y-%m-%dT%H:%MZ)"
  echo
  echo "| Check | Tool | Status | Findings | Output |"
  echo "|---|---|---|---|---|"
} > "$coverage"

row() { echo "| $1 | $2 | $3 | $4 | $5 |" >> "$coverage"; }
have() { command -v "$1" >/dev/null 2>&1; }
count_json() { node -e "$2" "$1" 2>/dev/null || echo "?"; }
# A tool whose output is missing, unreadable or an error report did NOT give coverage: say so.
status_of() { [ "$1" = "?" ] && echo "**failed**: no readable result, so this check is NOT covered" || echo "ran"; }
# Never count a previous run's file as this run's result.
for f in gitleaks-history.json gitleaks-files.json osv.json npm-audit.json semgrep.json trivy.json data-access-rules.json; do rm -f "$out/$f"; done

# --- Secrets: Gitleaks (MIT) -------------------------------------------------------
if have gitleaks; then
  if git -C "$project" rev-parse --git-dir >/dev/null 2>&1; then
    gitleaks git --no-banner --redact --exit-code 0 --report-format json \
      --report-path "$out/gitleaks-history.json" "$project" >/dev/null 2>&1
    n=$(count_json "$out/gitleaks-history.json" 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).length)')
    row "Secrets in git history (incl. deleted files)" "gitleaks $(gitleaks version)" "$(status_of "$n")" "$n" "gitleaks-history.json"
  fi
  gitleaks dir --no-banner --redact --exit-code 0 --config "$skill_dir/scripts/gitleaks.toml" \
    --report-format json --report-path "$out/gitleaks-files.json" "$project" >/dev/null 2>&1
  n=$(count_json "$out/gitleaks-files.json" 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).length)')
  row "Secrets in current files" "gitleaks $(gitleaks version)" "$(status_of "$n")" "$n" "gitleaks-files.json"
else
  row "Secrets" "gitleaks" "**not installed**: \`brew install gitleaks\` or github.com/gitleaks/gitleaks/releases" "–" "–"
fi

# --- Vulnerable dependencies: OSV-Scanner (Apache-2.0), fallback npm audit / pip-audit --
if have osv-scanner; then
  osv-scanner scan source -r --format json --output "$out/osv.json" "$project" >/dev/null 2>&1
  code=$?
  if [ "$code" -le 1 ] && [ -s "$out/osv.json" ]; then
    n=$(count_json "$out/osv.json" 'const d=JSON.parse(require("fs").readFileSync(process.argv[1]));let n=0;for(const r of d.results||[])for(const p of r.packages||[])n+=(p.vulnerabilities||[]).length;console.log(n)')
    row "Known-vulnerable dependencies" "osv-scanner" "$(status_of "$n")" "$n" "osv.json"
  elif [ "$code" -eq 128 ]; then
    row "Known-vulnerable dependencies" "osv-scanner" "no lockfiles found (add a lockfile to make builds reproducible)" "–" "–"
  else
    row "Known-vulnerable dependencies" "osv-scanner" "failed (exit $code; needs network access to osv.dev)" "–" "–"
  fi
elif [ -f "$project/package-lock.json" ] && have npm; then
  (cd "$project" && npm audit --json > "$out/npm-audit.json" 2>/dev/null)
  # npm audit exits non-zero both when it finds vulnerabilities and when it fails (offline, auth),
  # so read the report: an error object or a missing vulnerabilities list is a failed scan.
  n=$(count_json "$out/npm-audit.json" 'const d=JSON.parse(require("fs").readFileSync(process.argv[1]));if(d.error||!d.vulnerabilities)process.exit(1);console.log(Object.keys(d.vulnerabilities).length)')
  row "Known-vulnerable dependencies (npm only)" "npm audit" "$(status_of "$n")" "$n" "npm-audit.json"
else
  row "Known-vulnerable dependencies" "osv-scanner" "**not installed**: \`brew install osv-scanner\` or github.com/google/osv-scanner/releases" "–" "–"
fi

# --- Code patterns: Semgrep CE engine (LGPL-2.1) with our own rules (MIT) -------------
if have semgrep; then
  configs=(--config "$skill_dir/semgrep/")
  [ -d "$peak_rules" ] && configs+=(--config "$peak_rules/")
  label="own rules (security + peak-traffic)"
  if [ "${SEMGREP_REGISTRY:-0}" = "1" ]; then
    configs+=(--config p/default)
    label="$label + registry p/default (license!)"
  fi
  # The review's own output (launch-review/) and dependencies are not the project's code.
  semgrep scan --metrics=off --disable-version-check --quiet "${configs[@]}" --exclude launch-review --exclude node_modules --json --output "$out/semgrep.json" "$project" >/dev/null 2>&1
  n=$(count_json "$out/semgrep.json" 'const d=JSON.parse(require("fs").readFileSync(process.argv[1]));if(!Array.isArray(d.results))process.exit(1);console.log(d.results.length)')
  row "Risky code patterns" "semgrep $(semgrep --version 2>/dev/null): $label" "$(status_of "$n")" "$n" "semgrep.json"
else
  row "Risky code patterns" "semgrep" "**not installed**: \`pipx install semgrep\` or \`brew install semgrep\`" "–" "–"
fi

# --- Infrastructure / container config: Trivy (Apache-2.0), optional ----------------
if have trivy; then
  trivy fs --quiet --scanners misconfig --format json --output "$out/trivy.json" "$project" >/dev/null 2>&1
  n=$(count_json "$out/trivy.json" 'const d=JSON.parse(require("fs").readFileSync(process.argv[1]));let n=0;for(const r of d.Results||[])n+=(r.Misconfigurations||[]).filter(m=>m.Status==="FAIL").length;console.log(n)')
  row "Dockerfile / IaC misconfiguration" "trivy" "$(status_of "$n")" "$n" "trivy.json"
else
  row "Dockerfile / IaC misconfiguration" "trivy" "not installed (optional; only matters with Docker/Terraform/K8s files)" "–" "–"
fi

# --- Database access rules: Supabase RLS / Firebase rules (our script) ---------------
if have node; then
  node "$skill_dir/scripts/check-data-access-rules.mjs" "$project" "$out/data-access-rules.json" > "$out/data-access-rules.md"
  n=$(count_json "$out/data-access-rules.json" 'const d=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(d.findings.length + (d.filesChecked ? "" : " (no rule files found)"))')
  row "Supabase RLS / Firebase security rules" "check-data-access-rules.mjs" "$(status_of "$n")" "$n" "data-access-rules.md"
fi

{
  echo
  echo "Findings are leads, not verdicts: every one must be confirmed by reading the code before it goes in the report."
  echo "Not covered by these tools (needs the manual review): broken access control between users, business-logic flaws,"
  echo "architecture, concurrency, operations. See references/security.md and references/architecture.md."
} >> "$coverage"

cat "$coverage"
