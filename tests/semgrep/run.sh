#!/usr/bin/env bash
# Runs the semgrep rule fixtures in this folder. semgrep --test needs each rule file
# next to target files with the same base name, so stage them in a temp folder.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp "$root/.claude/skills/launch-review/semgrep/security.yml" "$tmp/"
cp "$root/.claude/skills/peak-traffic-test/semgrep/peak-traffic.yml" "$tmp/"
cp "$root"/tests/semgrep/security.* "$root"/tests/semgrep/peak-traffic.* "$tmp/"
semgrep --test --metrics=off --disable-version-check "$tmp"
