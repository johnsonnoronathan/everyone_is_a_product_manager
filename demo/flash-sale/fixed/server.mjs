import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, PoolTimeoutError, SQLITE_CONSTRAINT_UNIQUE } from '../shared/db.mjs';
import { PRODUCT, REVIEWERS, REVIEWS } from '../shared/seed-data.mjs';

const PORT = Number(process.env.PORT ?? 3000);
const PAYMENT_URL = process.env.PAYMENT_URL ?? 'http://127.0.0.1:4100';
const PAYMENT_SECRET_KEY = requireEnv('PAYMENT_SECRET_KEY');
const TOKEN_SECRET = requireEnv('TOKEN_SECRET');
const ADMIN_TOKEN = requireEnv('ADMIN_TOKEN');
// Stand-in for a real identity provider (magic link, OAuth). Only for test environments.
const DEMO_LOGIN = process.env.DEMO_LOGIN === '1';

const PAYMENT_TIMEOUT_MS = 3_000;
const PRODUCT_CACHE_MS = 1_000;
const MAX_BODY_BYTES = 10_000;
const RATE_LIMIT = { tokens: 5, perMs: 10_000 };
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../shared/public');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable ${name}`);
    process.exit(1);
  }
  return value;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Fail fast when the database is saturated instead of queueing requests forever.
const db = openDb({ acquireTimeoutMs: 1_000 });
db.exec(`
  CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, price_cents INTEGER NOT NULL, stock INTEGER NOT NULL CHECK (stock >= 0), initial_stock INTEGER NOT NULL);
  CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE reviews (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, user_id INTEGER NOT NULL, rating INTEGER, body TEXT);
  CREATE INDEX reviews_by_product ON reviews (product_id);
  CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, customer TEXT NOT NULL, amount_cents INTEGER NOT NULL, address TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE INDEX orders_by_customer ON orders (customer);
  -- One live order per customer per product. Failed payments don't count, so the customer can retry.
  CREATE UNIQUE INDEX one_live_order_per_customer ON orders (product_id, customer) WHERE status IN ('pending', 'paid');
`);

function seed(stock = PRODUCT.stock) {
  db.exec('DELETE FROM products; DELETE FROM users; DELETE FROM reviews; DELETE FROM orders;');
  const insert = (sql, ...params) => db.transaction((tx) => tx.run(sql, ...params));
  return Promise.all([
    insert('INSERT INTO products VALUES (?, ?, ?, ?, ?, ?)', PRODUCT.id, PRODUCT.name, PRODUCT.description, PRODUCT.priceCents, stock, stock),
    ...REVIEWERS.map((name, i) => insert('INSERT INTO users VALUES (?, ?)', i + 1, name)),
    ...REVIEWS.map((r) => insert('INSERT INTO reviews (product_id, user_id, rating, body) VALUES (?, ?, ?, ?)', PRODUCT.id, r.userId, r.rating, r.body)),
  ]);
}
await seed();

// Static files are read once at startup, not on every request.
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const staticFiles = new Map(
  Object.entries(STATIC).map(([route, [file, type]]) => [route, { type, body: fs.readFileSync(path.join(PUBLIC_DIR, file)) }]),
);

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
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// --- Sessions: HMAC-signed tokens with an expiry ---------------------------------
const sign = (payload) => crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');

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

function requireAdmin(req) {
  const given = Buffer.from(String(req.headers['x-admin-token'] ?? ''));
  const expected = Buffer.from(ADMIN_TOKEN);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new HttpError(404, 'Not found');
}

// --- Per-customer rate limit (token bucket) --------------------------------------
// In-memory is fine for one server. With several servers, move this to Redis.
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
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT.perMs;
  for (const [key, bucket] of buckets) if (bucket.at < cutoff) buckets.delete(key);
}, RATE_LIMIT.perMs).unref();

// --- Product page: two queries, cached for one second, one refresh at a time -----
const productCache = new Map();
function getProductPage(id) {
  const cached = productCache.get(id);
  if (cached && (cached.pending || Date.now() - cached.at < PRODUCT_CACHE_MS)) return cached.pending ?? cached.value;
  const pending = (async () => {
    const product = await db.get('SELECT id, name, description, price_cents, stock FROM products WHERE id = ?', id);
    const reviews = product
      ? await db.all(
          'SELECT r.rating, r.body, u.name AS author FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.product_id = ?',
          id,
        )
      : [];
    return product ? { ...product, reviews } : null;
  })();
  productCache.set(id, { pending, value: cached?.value, at: cached?.at ?? 0 });
  pending.then(
    (value) => productCache.set(id, { value, at: Date.now() }),
    () => productCache.delete(id),
  );
  return pending;
}

// Once a product sells out, buy attempts are answered without touching the database.
const soldOut = new Set();

async function chargeCard(amountCents, customer, idempotencyKey) {
  const res = await fetch(`${PAYMENT_URL}/charge`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${PAYMENT_SECRET_KEY}`,
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify({ amountCents, customer }),
    signal: AbortSignal.timeout(PAYMENT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Payment failed with status ${res.status}`);
  return res.json();
}

// --- Confirmation emails go through a background queue --------------------------
// In-memory for the demo. In production use a durable queue (SQS, BullMQ, Cloud Tasks)
// so a restart doesn't drop emails.
const emailQueue = [];
let emailWorkers = 0;
function queueConfirmationEmail(customer, orderId) {
  emailQueue.push({ customer, orderId });
  while (emailWorkers < 5 && emailQueue.length > 0) {
    emailWorkers++;
    (async () => {
      for (let job = emailQueue.shift(); job; job = emailQueue.shift()) {
        await new Promise((resolve) => setTimeout(resolve, 250)); // simulated SMTP call
      }
      emailWorkers--;
    })();
  }
}

const routes = {
  'POST /api/login': async (req, res) => {
    if (!DEMO_LOGIN) throw new HttpError(404, 'Not found');
    const { email } = await readBody(req);
    if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new HttpError(400, 'Valid email required');
    sendJson(res, 200, { token: issueToken(email.toLowerCase()) });
  },

  'GET /api/products/:id': async (req, res, params) => {
    const product = await getProductPage(Number(params.id));
    if (!product) throw new HttpError(404, 'Product not found');
    sendJson(res, 200, product, { 'cache-control': 'public, max-age=1' });
  },

  'GET /api/search': async (req, res, params, query) => {
    const q = (query.get('q') ?? '').slice(0, 100);
    sendJson(res, 200, await db.all("SELECT id, name, price_cents FROM products WHERE name LIKE ? ESCAPE '\\' LIMIT 20", `%${q.replace(/[\\%_]/g, '\\$&')}%`));
  },

  'POST /api/buy': async (req, res) => {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, 'Please sign in');
    if (!allow(user.email)) throw new HttpError(429, 'Too many attempts');
    const { productId, address } = await readBody(req);
    const id = Number(productId);
    if (soldOut.has(id)) throw new HttpError(410, 'Sold out');

    // The server decides the price. Whatever price the browser sends is ignored.
    const product = await getProductPage(id);
    if (!product) throw new HttpError(404, 'Product not found');

    // Reserve one unit and create a pending order in one transaction. The stock check and
    // the decrement are a single statement, so two buyers can never take the same unit.
    let orderId;
    try {
      orderId = await db.transaction((tx) => {
        const reserved = tx.run('UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0', id);
        if (reserved.changes === 0) return null;
        return tx.run(
          "INSERT INTO orders (product_id, customer, amount_cents, address, status, created_at) VALUES (?, ?, ?, ?, 'pending', datetime('now'))",
          id, user.email, product.price_cents, String(address ?? '').slice(0, 500),
        ).lastInsertRowid;
      });
    } catch (err) {
      if (err.errcode === SQLITE_CONSTRAINT_UNIQUE) throw new HttpError(409, 'You already have an order for this item');
      throw err;
    }
    if (orderId === null) {
      soldOut.add(id);
      throw new HttpError(410, 'Sold out');
    }

    try {
      // Same idempotency key on retries, so the provider never charges twice for one order.
      await chargeCard(product.price_cents, user.email, `order-${orderId}`);
    } catch (err) {
      console.warn(`payment failed for order ${orderId}: ${err.message}`);
      // Release the reservation. A timed-out charge may still settle later; the
      // idempotency key lets a reconciliation job match it to this order.
      await db.transaction((tx) => {
        tx.run("UPDATE orders SET status = 'payment_failed' WHERE id = ?", orderId);
        tx.run('UPDATE products SET stock = stock + 1 WHERE id = ?', id);
      });
      soldOut.delete(id);
      throw new HttpError(503, 'Payment did not go through. Please try again.');
    }

    await db.run("UPDATE orders SET status = 'paid' WHERE id = ?", orderId);
    queueConfirmationEmail(user.email, orderId);
    sendJson(res, 200, { orderId: Number(orderId), amountCents: product.price_cents });
  },

  'GET /api/orders/:id': async (req, res, params) => {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, 'Please sign in');
    const order = await db.get(
      'SELECT id, product_id, amount_cents, status, created_at FROM orders WHERE id = ? AND customer = ?',
      Number(params.id), user.email,
    );
    if (!order) throw new HttpError(404, 'Order not found');
    sendJson(res, 200, order);
  },

  'GET /api/my-orders': async (req, res) => {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, 'Please sign in');
    sendJson(res, 200, await db.all("SELECT id, product_id, amount_cents, status, created_at FROM orders WHERE customer = ? AND status = 'paid'", user.email));
  },

  'GET /healthz': async (req, res) => sendJson(res, 200, { ok: true, db: db.poolStats() }),

  'POST /api/admin/reset': async (req, res) => {
    requireAdmin(req);
    const { stock } = await readBody(req);
    await seed(Number.isInteger(stock) && stock >= 0 ? stock : PRODUCT.stock);
    productCache.clear();
    soldOut.clear();
    buckets.clear();
    await fetch(`${PAYMENT_URL}/reset`, { method: 'POST', signal: AbortSignal.timeout(PAYMENT_TIMEOUT_MS) });
    sendJson(res, 200, { ok: true });
  },

  'GET /api/admin/stats': async (req, res) => {
    requireAdmin(req);
    const product = await db.get('SELECT initial_stock, stock FROM products WHERE id = ?', PRODUCT.id);
    const orders = await db.get("SELECT COUNT(*) AS n, COUNT(DISTINCT customer) AS customers FROM orders WHERE status = 'paid'");
    const payments = await (await fetch(`${PAYMENT_URL}/stats`, { signal: AbortSignal.timeout(PAYMENT_TIMEOUT_MS) })).json();
    sendJson(res, 200, {
      initialStock: product.initial_stock,
      stockRemaining: product.stock,
      paidOrders: orders.n,
      distinctCustomers: orders.customers,
      payments,
    });
  },
};

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = req.method === 'GET' && staticFiles.get(url.pathname);
  if (file) {
    res.writeHead(200, { 'content-type': file.type, 'cache-control': 'public, max-age=300', ...SECURITY_HEADERS });
    return res.end(file.body);
  }
  const route = match(req.method, url.pathname);
  try {
    if (!route) throw new HttpError(404, 'Not found');
    await route.handler(req, res, route.params, url.searchParams);
  } catch (err) {
    if (res.headersSent) return res.destroy();
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
    if (err instanceof PoolTimeoutError) return sendJson(res, 503, { error: 'We are very busy. Please try again.' }, { 'retry-after': '2' });
    const requestId = crypto.randomUUID();
    console.error(`[${requestId}]`, err);
    sendJson(res, 500, { error: 'Something went wrong', requestId });
  }
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;

server.listen(PORT, () => console.log(`fixed flash sale running on http://127.0.0.1:${PORT}`));

// Graceful shutdown: finish in-flight requests, then exit (forced after 10 seconds).
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
