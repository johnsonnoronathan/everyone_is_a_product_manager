import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, PoolTimeoutError, SQLITE_CONSTRAINT_UNIQUE } from '../shared/db.mjs';
import { PRODUCT, REVIEWERS, REVIEWS } from '../shared/seed-data.mjs';

// --- Configuration ------------------------------------------------------------------
const PRODUCTION = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT ?? 3000);
const PAYMENT_URL = process.env.PAYMENT_URL ?? 'http://127.0.0.1:4100';
const PAYMENT_SECRET_KEY = requireSecret('PAYMENT_SECRET_KEY');
const TOKEN_SECRET = requireSecret('TOKEN_SECRET');
const ADMIN_TOKEN = requireSecret('ADMIN_TOKEN');
// Test-only switches: a stand-in for the real identity provider, and routes that reset data.
const DEMO_LOGIN = process.env.DEMO_LOGIN === '1';
const ENABLE_TEST_ROUTES = process.env.ENABLE_TEST_ROUTES === '1';
const SEED_DEMO_DATA = process.env.SEED_DEMO_DATA === '1';
if (PRODUCTION && (DEMO_LOGIN || ENABLE_TEST_ROUTES || SEED_DEMO_DATA)) {
  fail('DEMO_LOGIN, ENABLE_TEST_ROUTES and SEED_DEMO_DATA must be off in production');
}
// When the sale opens. Required in production so a deploy never opens the sale early.
const SALE_STARTS_AT = process.env.SALE_STARTS_AT ? new Date(process.env.SALE_STARTS_AT) : null;
if (SALE_STARTS_AT && Number.isNaN(SALE_STARTS_AT.getTime())) fail('SALE_STARTS_AT must be an ISO date, e.g. 2026-11-27T00:00:00-05:00');
if (PRODUCTION && !SALE_STARTS_AT) fail('SALE_STARTS_AT is required in production');

const PAYMENT_TIMEOUT_MS = 3_000;
const RECONCILE_INTERVAL_MS = Number(process.env.RECONCILE_INTERVAL_MS ?? 5_000);
const RECONCILE_AFTER_MS = PAYMENT_TIMEOUT_MS + 2_000;
const PENDING_ALERT_MS = 10 * 60_000;
const PRODUCT_CACHE_MS = 1_000;
const SOLD_OUT_CACHE_MS = 2_000;
const MAX_BODY_BYTES = 10_000;
const RATE_LIMIT = { tokens: 5, perMs: 10_000 };
// Long enough to sign in well before a midnight drop and still be signed in at midnight.
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../shared/public');

function fail(message) {
  console.error(`Refusing to start: ${message}`);
  process.exit(1);
}

function requireSecret(name) {
  const value = process.env[name];
  if (!value) fail(`missing required environment variable ${name}`);
  if (PRODUCTION && (value.length < 32 || /demo|change-?me|example|secret/i.test(value))) {
    fail(`${name} looks like a placeholder; use a long random value from your secret store`);
  }
  return value;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// --- Logging: one JSON line per event, no personal data -----------------------------
function log(event, fields = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...fields }));
}
// Pseudonymous customer reference for logs: lets support correlate events without storing emails in logs.
const customerRef = (email) => crypto.createHmac('sha256', TOKEN_SECRET).update(email).digest('hex').slice(0, 12);

// --- Database: versioned migrations, nothing destructive at start-up ----------------
// Fail fast when the database is saturated, but only before money moves (see settle()).
const db = openDb({ file: process.env.DB_FILE ?? ':memory:', acquireTimeoutMs: 1_000 });

// Append-only. In a larger app use a migration tool (Prisma Migrate, Knex, Flyway...).
const MIGRATIONS = [
  `CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, price_cents INTEGER NOT NULL,
     stock INTEGER NOT NULL CHECK (stock >= 0), initial_stock INTEGER NOT NULL);
   CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
   CREATE TABLE reviews (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), user_id INTEGER NOT NULL REFERENCES users(id), rating INTEGER, body TEXT);
   CREATE INDEX reviews_by_product ON reviews (product_id);`,
  `CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id),
     customer TEXT NOT NULL, ship_to TEXT NOT NULL, ship_to_key TEXT NOT NULL, amount_cents INTEGER NOT NULL,
     payment_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'payment_failed')),
     created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL);
   CREATE INDEX orders_by_customer ON orders (customer);
   CREATE INDEX orders_pending ON orders (status, created_ms);
   -- One live order per customer and per shipping address. Failed payments don't count.
   CREATE UNIQUE INDEX one_live_order_per_customer ON orders (product_id, customer) WHERE status IN ('pending', 'paid');
   CREATE UNIQUE INDEX one_live_order_per_address ON orders (product_id, ship_to_key) WHERE status IN ('pending', 'paid');`,
  `CREATE TABLE sale_settings (id INTEGER PRIMARY KEY CHECK (id = 1), starts_at TEXT, paused INTEGER NOT NULL DEFAULT 0);`,
  `CREATE TABLE email_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
     customer TEXT NOT NULL, created_ms INTEGER NOT NULL, sent_ms INTEGER);`,
];

async function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set((await db.all('SELECT version FROM schema_migrations')).map((r) => r.version));
  MIGRATIONS.forEach((sql, i) => {
    const version = i + 1;
    if (applied.has(version)) return;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, datetime('now'))").run(version);
      db.exec('COMMIT');
      log('migration_applied', { version });
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });
  // The sale schedule lives in the database so every server instance sees the same one.
  await db.transaction(
    (tx) => tx.run('INSERT OR IGNORE INTO sale_settings (id, starts_at, paused) VALUES (1, ?, 0)', SALE_STARTS_AT?.toISOString() ?? null),
    { acquireTimeoutMs: 0 },
  );
}

// Demo/test data only. Production stock is loaded with a one-off, audited admin script.
async function loadDemoData({ stock = PRODUCT.stock, wipe = false } = {}) {
  await db.transaction(
    (tx) => {
      if (!wipe && tx.get('SELECT 1 FROM products LIMIT 1')) return;
      if (wipe) {
        tx.run('DELETE FROM email_outbox');
        tx.run('DELETE FROM orders');
        tx.run('DELETE FROM reviews');
        tx.run('DELETE FROM users');
        tx.run('DELETE FROM products');
        tx.run('UPDATE sale_settings SET starts_at = ?, paused = 0 WHERE id = 1', SALE_STARTS_AT?.toISOString() ?? null);
      }
      tx.run('INSERT INTO products VALUES (?, ?, ?, ?, ?, ?)', PRODUCT.id, PRODUCT.name, PRODUCT.description, PRODUCT.priceCents, stock, stock);
      REVIEWERS.forEach((name, i) => tx.run('INSERT INTO users VALUES (?, ?)', i + 1, name));
      REVIEWS.forEach((r) => tx.run('INSERT INTO reviews (product_id, user_id, rating, body) VALUES (?, ?, ?, ?)', PRODUCT.id, r.userId, r.rating, r.body));
    },
    { acquireTimeoutMs: 0 },
  );
}

await migrate();
if (SEED_DEMO_DATA) await loadDemoData();

// --- Static files: read once, versioned so a hotfix reaches browsers immediately -----
const assetVersion = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(PUBLIC_DIR, file))).digest('hex').slice(0, 10);
const versions = { 'app.js': assetVersion('app.js'), 'style.css': assetVersion('style.css') };
const indexHtml = fs
  .readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
  .replace('/app.js', `/app.js?v=${versions['app.js']}`)
  .replace('/style.css', `/style.css?v=${versions['style.css']}`);
const staticFiles = new Map([
  ['/', { type: 'text/html; charset=utf-8', body: Buffer.from(indexHtml) }],
  ['/app.js', { type: 'text/javascript; charset=utf-8', body: fs.readFileSync(path.join(PUBLIC_DIR, 'app.js')) }],
  ['/style.css', { type: 'text/css; charset=utf-8', body: fs.readFileSync(path.join(PUBLIC_DIR, 'style.css')) }],
]);

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...SECURITY_HEADERS, ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) reject(new HttpError(413, 'Request too large'));
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      let parsed;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        return reject(new HttpError(400, 'Invalid JSON'));
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return reject(new HttpError(400, 'Expected a JSON object'));
      resolve(parsed);
    });
    req.on('error', reject);
  });
}

// --- Sessions: HMAC-signed tokens with an expiry ------------------------------------
// In production the managed identity provider issues and verifies sessions; this mirrors that contract.
const sign = (payload) => crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');

// One customer = one mailbox: case and "+tags" don't make a new customer.
function normaliseEmail(email) {
  const [local, domain] = email.trim().toLowerCase().split('@');
  return `${local.split('+')[0]}@${domain}`;
}

function issueToken(email) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function currentUser(req) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return claims.exp > Date.now() ? claims : null;
  } catch {
    return null;
  }
}

function requireAdmin(req, action) {
  const given = Buffer.from(String(req.headers['x-admin-token'] ?? ''));
  const expected = Buffer.from(ADMIN_TOKEN);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new HttpError(404, 'Not found');
  log('admin_action', { action });
}

// --- Per-customer rate limit (token bucket) --------------------------------------
// In-memory: correct for one server. Move to Redis before running a second instance.
const buckets = new Map();
function allow(key) {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: RATE_LIMIT.tokens, at: now };
  bucket.tokens = Math.min(RATE_LIMIT.tokens, bucket.tokens + ((now - bucket.at) / RATE_LIMIT.perMs) * RATE_LIMIT.tokens);
  bucket.at = now;
  buckets.set(key, bucket);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}
const bucketSweeper = setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT.perMs;
  for (const [key, bucket] of buckets) if (bucket.at < cutoff) buckets.delete(key);
}, RATE_LIMIT.perMs);
bucketSweeper.unref();

// --- Catalogue: known products, product page cache, sale schedule -----------------
// Requests for product ids that don't exist are answered without touching the database.
let knownProducts = new Set();
async function refreshKnownProducts() {
  knownProducts = new Set((await db.all('SELECT id FROM products')).map((r) => r.id));
}
await refreshKnownProducts();
const productRefresher = setInterval(() => refreshKnownProducts().catch((err) => log('refresh_failed', { error: err.message })), 30_000);
productRefresher.unref();

function cached(loader, ttlMs) {
  const entries = new Map();
  const fn = (key) => {
    const hit = entries.get(key);
    if (hit && (hit.pending || Date.now() - hit.at < ttlMs)) return hit.pending ?? Promise.resolve(hit.value);
    const pending = loader(key);
    entries.set(key, { pending, value: hit?.value, at: hit?.at ?? 0 });
    pending.then(
      (value) => entries.set(key, { value, at: Date.now() }),
      () => entries.delete(key),
    );
    return pending;
  };
  fn.clear = () => entries.clear();
  return fn;
}

// Two queries per refresh, at most one refresh per second per product.
const getProductPage = cached(async (id) => {
  const product = await db.get('SELECT id, name, description, price_cents, stock FROM products WHERE id = ?', id);
  if (!product) return null;
  const reviews = await db.all(
    'SELECT r.rating, r.body, u.name AS author FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.product_id = ?',
    id,
  );
  return { ...product, reviews };
}, PRODUCT_CACHE_MS);

const getSale = cached(async () => {
  const row = await db.get('SELECT starts_at, paused FROM sale_settings WHERE id = 1');
  return { startsAt: row?.starts_at ?? null, paused: Boolean(row?.paused) };
}, 1_000);

const checkReady = cached(() => db.get('SELECT 1').then(() => true, () => false), 1_000);

// Briefly remember "sold out" to answer the rush without the database; short enough that
// pairs released by failed payments come back on sale within seconds.
const soldOutUntil = new Map();

// --- Payments -----------------------------------------------------------------------
class PaymentDeclined extends Error {}

// The idempotency key belongs to the order, so every retry of this charge (by the
// request, the reconciler or a person) is the same charge to the provider.
async function chargeCard(order) {
  const res = await fetch(`${PAYMENT_URL}/charge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${PAYMENT_SECRET_KEY}`, 'idempotency-key': order.payment_key },
    body: JSON.stringify({ amountCents: order.amount_cents, customer: order.customer }),
    signal: AbortSignal.timeout(PAYMENT_TIMEOUT_MS),
  });
  if (res.status === 402) throw new PaymentDeclined('card declined');
  // Anything else that isn't a success (timeout, 409 still processing, 5xx) means "we don't know yet".
  if (!res.ok) throw new Error(`payment provider answered ${res.status}`);
  return res.json();
}

// Writes after money moved must land: wait for a connection instead of failing fast, and retry.
async function settle(fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(fn, { acquireTimeoutMs: 0 });
    } catch (err) {
      if (attempt >= 5) throw err;
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
}

function markPaid(order) {
  return settle((tx) => {
    const updated = tx.run("UPDATE orders SET status = 'paid', updated_ms = ? WHERE id = ? AND status = 'pending'", Date.now(), order.id);
    // Confirmation email goes into the outbox in the same transaction, so it can't be lost.
    if (updated.changes) tx.run('INSERT OR IGNORE INTO email_outbox (order_id, customer, created_ms) VALUES (?, ?, ?)', order.id, order.customer, Date.now());
  });
}

function releaseOrder(order) {
  return settle((tx) => {
    const updated = tx.run("UPDATE orders SET status = 'payment_failed', updated_ms = ? WHERE id = ? AND status = 'pending'", Date.now(), order.id);
    if (updated.changes) tx.run('UPDATE products SET stock = stock + 1 WHERE id = ?', order.product_id);
  });
}

// Returns 'paid', 'declined' or 'unknown'. Unknown keeps the pair reserved; the reconciler settles it.
async function attemptCharge(order) {
  try {
    await chargeCard(order);
  } catch (err) {
    if (err instanceof PaymentDeclined) {
      await releaseOrder(order);
      soldOutUntil.delete(order.product_id);
      log('payment_declined', { orderId: order.id });
      return 'declined';
    }
    log('payment_unknown', { orderId: order.id, reason: err.name === 'TimeoutError' ? 'timeout' : err.message });
    return 'unknown';
  }
  try {
    await markPaid(order);
  } catch (err) {
    log('settle_failed', { orderId: order.id, error: err.message });
    return 'unknown';
  }
  log('order_paid', { orderId: order.id, customer: customerRef(order.customer) });
  return 'paid';
}

// Settles orders whose payment outcome is unknown by repeating the same charge (same
// idempotency key): the provider returns the original result or completes it once.
let reconciling = false;
async function reconcile() {
  if (reconciling) return;
  reconciling = true;
  try {
    const stale = await db.all(
      "SELECT * FROM orders WHERE status = 'pending' AND created_ms < ? ORDER BY created_ms LIMIT 50",
      Date.now() - RECONCILE_AFTER_MS,
    );
    for (const order of stale) {
      const outcome = await attemptCharge(order);
      if (outcome === 'unknown' && Date.now() - order.created_ms > PENDING_ALERT_MS) {
        log('ALERT_payment_stuck', { orderId: order.id, minutes: Math.round((Date.now() - order.created_ms) / 60_000) });
      }
    }
  } catch (err) {
    log('reconcile_failed', { error: err.message });
  } finally {
    reconciling = false;
  }
}
const reconciler = setInterval(reconcile, RECONCILE_INTERVAL_MS);
reconciler.unref();

// --- Confirmation emails: durable outbox ---------------------------------------------
let sendingEmails = false;
async function sendQueuedEmails() {
  if (sendingEmails) return;
  sendingEmails = true;
  try {
    const batch = await db.all('SELECT id, order_id FROM email_outbox WHERE sent_ms IS NULL ORDER BY id LIMIT 20');
    for (const email of batch) {
      await new Promise((resolve) => setTimeout(resolve, 50)); // simulated call to the email provider
      await settle((tx) => tx.run('UPDATE email_outbox SET sent_ms = ? WHERE id = ?', Date.now(), email.id));
      log('email_sent', { orderId: email.order_id });
    }
  } catch (err) {
    log('email_send_failed', { error: err.message });
  } finally {
    sendingEmails = false;
  }
}
const mailer = setInterval(sendQueuedEmails, 1_000);
mailer.unref();

// --- Orders --------------------------------------------------------------------------
function cleanAddress(value) {
  const shipTo = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (shipTo.length < 10 || shipTo.length > 300) throw new HttpError(400, 'Please enter your full shipping address');
  return { shipTo, key: shipTo.toLowerCase().replace(/[^a-z0-9]/g, '') };
}

async function saleState() {
  const sale = await getSale();
  return {
    startsAt: sale.startsAt,
    paused: sale.paused,
    open: !sale.paused && (!sale.startsAt || Date.parse(sale.startsAt) <= Date.now()),
    serverTime: new Date().toISOString(),
  };
}

const routes = {
  'POST /api/login': async (req, res) => {
    if (!DEMO_LOGIN) throw new HttpError(404, 'Not found');
    const { email } = await readBody(req);
    if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) throw new HttpError(400, 'Valid email required');
    const normalised = normaliseEmail(email);
    log('login', { customer: customerRef(normalised) });
    sendJson(res, 200, { token: issueToken(normalised) });
  },

  'GET /api/products/:id': async (req, res, params) => {
    const id = Number(params.id);
    if (!knownProducts.has(id)) throw new HttpError(404, 'Product not found');
    const [product, sale] = await Promise.all([getProductPage(id), saleState()]);
    if (!product) throw new HttpError(404, 'Product not found');
    sendJson(res, 200, { ...product, sale }, { 'cache-control': 'public, max-age=1' });
  },

  'POST /api/buy': async (req, res) => {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, 'Please sign in');
    if (!allow(user.email)) throw new HttpError(429, 'Too many attempts');
    const body = await readBody(req);
    const id = Number(body.productId);
    if (!knownProducts.has(id)) throw new HttpError(404, 'Product not found');
    const address = cleanAddress(body.address);

    const sale = await saleState();
    if (sale.paused) throw new HttpError(403, 'The sale is paused. Please check back in a few minutes.');
    if (!sale.open) throw new HttpError(403, `The sale opens at ${sale.startsAt}`);
    if ((soldOutUntil.get(id) ?? 0) > Date.now()) throw new HttpError(410, 'Sold out');

    // The server decides the price. Whatever price the browser sends is ignored.
    const product = await getProductPage(id);
    if (!product) throw new HttpError(404, 'Product not found');

    // Reserve one pair and create a pending order in one transaction. The stock check and the
    // decrement are one statement, so two buyers can never take the same pair.
    const now = Date.now();
    const order = { product_id: id, customer: user.email, amount_cents: product.price_cents, payment_key: crypto.randomUUID(), created_ms: now };
    try {
      order.id = await db.transaction((tx) => {
        const reserved = tx.run('UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0', id);
        if (reserved.changes === 0) return null;
        return Number(
          tx.run(
            "INSERT INTO orders (product_id, customer, ship_to, ship_to_key, amount_cents, payment_key, status, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
            id, user.email, address.shipTo, address.key, order.amount_cents, order.payment_key, now, now,
          ).lastInsertRowid,
        );
      });
    } catch (err) {
      if (err.errcode === SQLITE_CONSTRAINT_UNIQUE) {
        throw new HttpError(409, /ship_to_key/.test(err.message)
          ? 'This address already has an order for this item (limit one per customer)'
          : 'You already have an order for this item');
      }
      throw err;
    }
    if (order.id === null) {
      soldOutUntil.set(id, Date.now() + SOLD_OUT_CACHE_MS);
      throw new HttpError(410, 'Sold out');
    }
    log('order_reserved', { orderId: order.id, customer: customerRef(user.email) });

    const outcome = await attemptCharge(order);
    if (outcome === 'paid') return sendJson(res, 200, { orderId: order.id, status: 'paid', amountCents: order.amount_cents });
    if (outcome === 'declined') throw new HttpError(402, 'Your card was declined. You have not been charged.');
    // Timed out or unclear: the pair stays reserved, and we never ask the customer to pay again.
    sendJson(res, 202, {
      orderId: order.id,
      status: 'confirming',
      message: "We're confirming your payment with the bank. Your pair is reserved. Please don't pay again.",
    });
  },

  'GET /api/orders/:id': async (req, res, params) => {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, 'Please sign in');
    const order = await db.get(
      'SELECT id, product_id, amount_cents, status, created_ms FROM orders WHERE id = ? AND customer = ?',
      Number(params.id), user.email,
    );
    if (!order) throw new HttpError(404, 'Order not found');
    sendJson(res, 200, order);
  },

  'GET /api/my-orders': async (req, res) => {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, 'Please sign in');
    sendJson(res, 200, await db.all("SELECT id, product_id, amount_cents, status, created_ms FROM orders WHERE customer = ? AND status = 'paid'", user.email));
  },

  // Liveness, for the load balancer: the process answers. Deliberately doesn't wait on the
  // database, so a busy database at peak doesn't get the only server taken out of rotation.
  'GET /healthz': async (req, res) => sendJson(res, 200, { ok: true }),

  // Readiness, for deploys: the database is reachable. Cached for a second so it can't be
  // used to flood the database. No internals exposed.
  'GET /readyz': async (req, res) => {
    const ok = await checkReady();
    sendJson(res, ok ? 200 : 503, { ok });
  },

  // Pause/resume the sale or move its start time, without a deploy and without touching orders.
  'POST /api/admin/sale': async (req, res) => {
    requireAdmin(req, 'sale_settings');
    const body = await readBody(req);
    const changes = {};
    if (body.paused !== undefined) changes.paused = body.paused ? 1 : 0;
    if (body.startsAt !== undefined) {
      if (body.startsAt !== null && Number.isNaN(Date.parse(body.startsAt))) throw new HttpError(400, 'startsAt must be an ISO date or null');
      changes.startsAt = body.startsAt === null ? null : new Date(body.startsAt).toISOString();
    }
    await settle((tx) => {
      if ('paused' in changes) tx.run('UPDATE sale_settings SET paused = ? WHERE id = 1', changes.paused);
      if ('startsAt' in changes) tx.run('UPDATE sale_settings SET starts_at = ? WHERE id = 1', changes.startsAt);
    });
    getSale.clear();
    log('sale_settings_changed', changes);
    sendJson(res, 200, await saleState());
  },

  'GET /api/admin/stats': async (req, res) => {
    requireAdmin(req, 'stats');
    const product = await db.get('SELECT initial_stock, stock FROM products WHERE id = ?', PRODUCT.id);
    const orders = await db.get(
      "SELECT SUM(status = 'paid') AS paid, SUM(status = 'pending') AS pending, COUNT(DISTINCT CASE WHEN status = 'paid' THEN customer END) AS customers FROM orders",
    );
    const stats = {
      initialStock: product?.initial_stock ?? 0,
      stockRemaining: product?.stock ?? 0,
      paidOrders: orders.paid ?? 0,
      pendingOrders: orders.pending ?? 0,
      distinctCustomers: orders.customers ?? 0,
    };
    // The test payment provider exposes totals for reconciliation checks; real providers have reports.
    if (ENABLE_TEST_ROUTES) {
      stats.payments = await (await fetch(`${PAYMENT_URL}/stats`, { signal: AbortSignal.timeout(PAYMENT_TIMEOUT_MS) })).json();
    }
    sendJson(res, 200, stats);
  },
};

// Test-only: wipe and reload demo data. Not even registered unless ENABLE_TEST_ROUTES=1.
if (ENABLE_TEST_ROUTES) {
  routes['POST /api/admin/reset'] = async (req, res) => {
    requireAdmin(req, 'test_reset');
    const { stock } = await readBody(req);
    await loadDemoData({ stock: Number.isInteger(stock) && stock >= 0 ? stock : PRODUCT.stock, wipe: true });
    await refreshKnownProducts();
    getProductPage.clear();
    getSale.clear();
    soldOutUntil.clear();
    buckets.clear();
    await fetch(`${PAYMENT_URL}/reset`, { method: 'POST', signal: AbortSignal.timeout(PAYMENT_TIMEOUT_MS) });
    sendJson(res, 200, { ok: true });
  };
}

const compiledRoutes = Object.entries(routes).map(([key, handler]) => {
  const [method, pattern] = key.split(' ');
  const names = [];
  const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+)')) + '$');
  return { method, regex, names, handler };
});

function match(method, pathname) {
  for (const route of compiledRoutes) {
    if (route.method !== method) continue;
    const found = pathname.match(route.regex);
    if (found) return { handler: route.handler, params: Object.fromEntries(route.names.map((n, i) => [n, found[i + 1]])) };
  }
  return null;
}

async function handle(req, res) {
  try {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      throw new HttpError(400, 'Bad request');
    }
    const file = req.method === 'GET' && staticFiles.get(url.pathname);
    if (file) {
      // HTML is always revalidated; versioned assets can be cached for a year.
      const cache = url.pathname === '/' ? 'no-cache' : url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'no-cache';
      res.writeHead(200, { 'content-type': file.type, 'cache-control': cache, ...SECURITY_HEADERS });
      return res.end(file.body);
    }
    const route = match(req.method, url.pathname);
    if (!route) throw new HttpError(404, 'Not found');
    await route.handler(req, res, route.params, url.searchParams);
  } catch (err) {
    if (res.headersSent) return res.destroy();
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
    if (err instanceof PoolTimeoutError) return sendJson(res, 503, { error: 'We are very busy. Please try again.' }, { 'retry-after': '2' });
    const requestId = crypto.randomUUID();
    log('request_failed', { requestId, error: err.stack ?? String(err) });
    sendJson(res, 500, { error: 'Something went wrong', requestId });
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    log('request_failed', { error: err.stack ?? String(err) });
    res.destroy();
  });
});
// Keep idle connections open longer than the load balancer does (AWS ALB default: 60 s), or it
// reuses connections Node has already closed and shoppers get random 502s.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 66_000;

// Last line of defence: log, don't die, for promise rejections nobody handled.
process.on('unhandledRejection', (reason) => log('unhandled_rejection', { error: String(reason?.stack ?? reason) }));

server.listen(PORT, () => log('server_started', { port: PORT, testRoutes: ENABLE_TEST_ROUTES, saleStartsAt: SALE_STARTS_AT?.toISOString() ?? null }));

// Graceful shutdown on every deploy: stop taking requests, finish in-flight ones (forced after 10 s).
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    log('shutting_down', { signal });
    for (const timer of [reconciler, mailer, bucketSweeper, productRefresher]) clearInterval(timer);
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
