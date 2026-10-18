#!/usr/bin/env bash
# ARC-05 / ARC-02 (crash mid-payment) / ARC-11 (opening time after a restart) on a LOCAL instance with a
# persistent database file. Never run against production.
#   ADMIN_TOKEN=<local admin token> bash repro-restart.sh <scratch-dir>
# Starts and stops `node demo/flash-sale/run.mjs fixed` on ports 3100/4200 itself, by PID.
set -uo pipefail
: "${ADMIN_TOKEN:?set ADMIN_TOKEN to the local instance admin token}"
scratch="${1:?usage: repro-restart.sh <scratch-dir>}"
repo="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
here="$(cd "$(dirname "$0")" && pwd)"
db="$scratch/restart.sqlite"
if pgrep -f 'demo/flash-sale/(fixed/server|shared/fake-payment)' > /dev/null; then echo "another instance is running; stop it first"; exit 1; fi
rm -f "$db"
B=http://127.0.0.1:3100
P=http://127.0.0.1:4200

start() { # $1 = log name, rest = env assignments
  local name=$1; shift
  (cd "$repo" || exit 1; env "$@" PORT=3100 PAYMENT_PORT=4200 DB_FILE="$db" nohup node demo/flash-sale/run.mjs fixed > "$scratch/$name.log" 2>&1 & echo $! > "$scratch/$name.pid")
  for _ in $(seq 1 40); do curl -s -m 1 $B/healthz > /dev/null && return; sleep 0.25; done
  echo "did not start"; cat "$scratch/$name.log"; exit 1
}
stop() { # SIGTERM the launcher by PID, then wait until the app and simulator have exited
  kill "$(cat "$scratch/$1.pid")" 2> /dev/null
  for _ in $(seq 1 40); do pgrep -f 'demo/flash-sale/(fixed/server|shared/fake-payment)' > /dev/null || return; sleep 0.5; done
  echo "warning: instance still running"
}
stats() { curl -s $B/api/admin/stats -H "x-admin-token: $ADMIN_TOKEN"; echo; }
sale() { curl -s $B/api/products/1 | node -pe 'JSON.stringify(JSON.parse(require("fs").readFileSync(0)).sale)'; }
token() { curl -s -X POST $B/api/login -d "{\"email\":\"$1\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).token'; }
buy() { curl -s -m 10 -w ' %{http_code}' -X POST $B/api/buy -H "authorization: Bearer $1" -d "{\"productId\":1,\"address\":\"$2\"}"; echo; }

opened=$(node -e 'console.log(new Date(Date.now() - 60_000).toISOString())')
echo "=== 1. first boot: SALE_STARTS_AT=$opened (already open), payments take 4 s (> the app's 3 s timeout)"
start boot1 SALE_STARTS_AT="$opened" PAYMENT_MIN_MS=4000 PAYMENT_MAX_MS=4100 RECONCILE_INTERVAL_MS=60000
grep -h '"server_started"\|migration_applied' "$scratch/boot1.log"
curl -s -X POST $P/config -d '{"minMs":80,"maxMs":200}' > /dev/null
echo "uma buys (fast payment): $(buy "$(token uma@example.com)" '10 Uma Street, Springfield')"
curl -s -X POST $P/config -d '{"minMs":4000,"maxMs":4100}' > /dev/null
echo "vic buys (slow payment): $(buy "$(token vic@example.com)" '11 Vic Street, Springfield')"
echo "stats: $(stats)"
echo "--- crash: SIGKILL the app process before the reconciler runs (interval set to 60 s)"
kill -9 "$(pgrep -f 'demo/flash-sale/fixed/server.mjs')"
stop boot1
pgrep -af 'demo/flash-sale/(fixed/server|shared/fake-payment)' || echo "(app and simulator stopped)"

later=$(node -e 'console.log(new Date(Date.now() + 2 * 86400_000).toISOString())')
echo
echo "=== 2. second boot, same database, SALE_STARTS_AT changed to $later, SEED_DEMO_DATA still 1"
start boot2 SALE_STARTS_AT="$later"
grep -h '"server_started"\|migration_applied' "$scratch/boot2.log" || true
echo "effective sale settings (GET /api/products/1 .sale): $(sale)"
echo "stats right after restart: $(stats)"
sleep 12
echo "stats 12 s later (reconciler every 5 s): $(stats)"
grep -h 'payment_unknown\|order_paid\|email_sent' "$scratch/boot2.log" | head -5
echo "wes buys although the server logged saleStartsAt=$later: $(buy "$(token wes@example.com)" '12 Wes Street, Springfield')"
stop boot2

echo
echo "=== 3. OPS-09: the previous release's start-up DDL (commit d572634) against this database"
node "$here/rollback-ddl.mjs" "$db"
