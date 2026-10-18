import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../shared/db.mjs';
import { PRODUCT, REVIEWERS, REVIEWS } from '../shared/seed-data.mjs';

const PORT = Number(process.env.PORT ?? 3000);
const PAYMENT_URL = process.env.PAYMENT_URL ?? 'http://127.0.0.1:4100';
const PAYMENT_SECRET_KEY = 'pay_live_8f3Kq9ZxL2mN7vB4cR1tY6wP0sD5hJ3g';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../shared/public');

const db = openDb();
db.exec(`
  CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, description TEXT, price_cents INTEGER, stock INTEGER, initial_stock INTEGER);
  CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE reviews (id INTEGER PRIMARY KEY, product_id INTEGER, user_id INTEGER, rating INTEGER, body TEXT);
  CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, customer TEXT, amount_cents INTEGER, address TEXT, status TEXT, created_at TEXT);
`);

function seed(stock = PRODUCT.stock) {
  db.exec('DELETE FROM products; DELETE FROM users; DELETE FROM reviews; DELETE FROM orders;');
  db.exec(`INSERT INTO products VALUES (${PRODUCT.id}, '${PRODUCT.name}', '${PRODUCT.description}', ${PRODUCT.priceCents}, ${stock}, ${stock})`);
  REVIEWERS.forEach((name, i) => db.exec(`INSERT INTO users VALUES (${i + 1}, '${name}')`));
  REVIEWS.forEach((r) => db.exec(`INSERT INTO reviews (product_id, user_id, rating, body) VALUES (${PRODUCT.id}, ${r.userId}, ${r.rating}, '${r.body}')`));
}
seed();

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data ? JSON.parse(data) : {}));
  });
}

function currentUser(req) {
  const header = req.headers.authorization ?? '';
  const token = header.replace('Bearer ', '');
  if (!token) return null;
  return JSON.parse(Buffer.from(token, 'base64').toString());
}

async function chargeCard(amountCents, customer) {
  const res = await fetch(`${PAYMENT_URL}/charge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${PAYMENT_SECRET_KEY}` },
    body: JSON.stringify({ amountCents, customer }),
  });
  if (!res.ok) throw new Error(`Payment failed with status ${res.status}`);
  return res.json();
}

async function sendConfirmationEmail(customer, orderId) {
  // Simulates talking to an SMTP server.
  await new Promise((resolve) => setTimeout(resolve, 250));
  console.log(`email sent to ${customer} for order ${orderId}`);
}

const routes = {
  'GET /': async (req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(fs.readFileSync(path.join(PUBLIC_DIR, 'index.html')));
  },
  'GET /app.js': async (req, res) => {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(fs.readFileSync(path.join(PUBLIC_DIR, 'app.js')));
  },
  'GET /style.css': async (req, res) => {
    res.writeHead(200, { 'content-type': 'text/css' });
    res.end(fs.readFileSync(path.join(PUBLIC_DIR, 'style.css')));
  },

  'POST /api/login': async (req, res) => {
    const { email } = await readBody(req);
    const token = Buffer.from(JSON.stringify({ email })).toString('base64');
    sendJson(res, 200, { token });
  },

  'GET /api/products/:id': async (req, res, params) => {
    const product = await db.get('SELECT * FROM products WHERE id = ?', params.id);
    if (!product) return sendJson(res, 404, { error: 'Product not found' });
    const reviews = await db.all('SELECT * FROM reviews WHERE product_id = ?', params.id);
    for (const review of reviews) {
      const author = await db.get('SELECT name FROM users WHERE id = ?', review.user_id);
      review.author = author.name;
    }
    sendJson(res, 200, { ...product, reviews });
  },

  'GET /api/search': async (req, res, params, query) => {
    const q = query.get('q') ?? '';
    const results = await db.all(`SELECT id, name, price_cents FROM products WHERE name LIKE '%${q}%'`);
    sendJson(res, 200, results);
  },

  'POST /api/buy': async (req, res) => {
    const user = currentUser(req);
    if (!user) return sendJson(res, 401, { error: 'Please sign in' });
    const { productId, price, address } = await readBody(req);

    const product = await db.get('SELECT * FROM products WHERE id = ?', productId);
    if (!product || product.stock <= 0) return sendJson(res, 410, { error: 'Sold out' });

    await chargeCard(price, user.email);
    await db.run('UPDATE products SET stock = ? WHERE id = ?', product.stock - 1, productId);
    const order = await db.run(
      "INSERT INTO orders (product_id, customer, amount_cents, address, status, created_at) VALUES (?, ?, ?, ?, 'paid', datetime('now'))",
      productId, user.email, price, address ?? '',
    );
    await sendConfirmationEmail(user.email, order.lastInsertRowid);
    sendJson(res, 200, { orderId: Number(order.lastInsertRowid), amountCents: price });
  },

  'GET /api/orders/:id': async (req, res, params) => {
    const order = await db.get('SELECT * FROM orders WHERE id = ?', params.id);
    if (!order) return sendJson(res, 404, { error: 'Order not found' });
    sendJson(res, 200, order);
  },

  'GET /api/my-orders': async (req, res) => {
    const user = currentUser(req);
    if (!user) return sendJson(res, 401, { error: 'Please sign in' });
    sendJson(res, 200, await db.all('SELECT * FROM orders WHERE customer = ?', user.email));
  },

  'POST /api/admin/reset': async (req, res) => {
    const { stock } = await readBody(req);
    seed(stock ?? PRODUCT.stock);
    await fetch(`${PAYMENT_URL}/reset`, { method: 'POST' });
    sendJson(res, 200, { ok: true });
  },

  'GET /api/admin/stats': async (req, res) => {
    const product = await db.get('SELECT * FROM products WHERE id = ?', PRODUCT.id);
    const orders = await db.get("SELECT COUNT(*) AS n, COUNT(DISTINCT customer) AS customers FROM orders WHERE status = 'paid'");
    const payments = await (await fetch(`${PAYMENT_URL}/stats`)).json();
    sendJson(res, 200, {
      initialStock: product.initial_stock,
      stockRemaining: product.stock,
      paidOrders: orders.n,
      distinctCustomers: orders.customers,
      payments,
    });
  },
};

function match(method, pathname) {
  for (const [key, handler] of Object.entries(routes)) {
    const [m, pattern] = key.split(' ');
    if (m !== method) continue;
    const names = [];
    const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+)')) + '$');
    const found = pathname.match(regex);
    if (found) return { handler, params: Object.fromEntries(names.map((n, i) => [n, found[i + 1]])) };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = match(req.method, url.pathname);
  if (!route) return sendJson(res, 404, { error: 'Not found' });
  try {
    await route.handler(req, res, route.params, url.searchParams);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(err.stack);
  }
});

server.listen(PORT, () => console.log(`naive flash sale running on http://127.0.0.1:${PORT}`));
