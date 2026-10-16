// One test per acceptance criterion in ../criteria.md. Each test is tagged with its AC id
// so the report can trace criterion → test → result → evidence.
import fs from 'node:fs';
import { test, expect, devices } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ADMIN = { 'x-admin-token': 'demo-admin-token' };
const PAYMENT_PROVIDER = 'http://127.0.0.1:4100';
let counter = 0;
const uniqueEmail = (name) => `${name}-${Date.now()}-${counter++}@acceptance.test`;

async function resetSale(request, stock = 100) {
  const res = await request.post('/api/admin/reset', { headers: ADMIN, data: { stock } });
  expect(res.ok(), 'test setup: reset sale data').toBeTruthy();
}

async function apiLogin(request, email) {
  const res = await request.post('/api/login', { data: { email } });
  return (await res.json()).token;
}

async function signInOnPage(page, email) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
}

// API-level tests have no screenshot, so save what was sent and received as evidence.
async function attachEvidence(data) {
  const file = test.info().outputPath('evidence.json');
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  await test.info().attach('evidence', { path: file, contentType: 'application/json' });
}

async function myOrders(request, token) {
  const res = await request.get('/api/my-orders', { headers: { authorization: `Bearer ${token}` } });
  return res.json();
}

test.beforeEach(async ({ request }) => {
  await resetSale(request);
});

test('AC-01 shopper sees the product, price and stock', { tag: '@AC-01' }, async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Limited Edition Holiday Sneakers');
  await expect(page.getByText('$49.99')).toBeVisible();
  await expect(page.getByTestId('stock')).toHaveText('100 left');
});

test('AC-02 signed-in shopper can buy and gets a confirmation', { tag: '@AC-02' }, async ({ page, request }) => {
  const email = uniqueEmail('buyer');
  await signInOnPage(page, email);
  await page.getByRole('button', { name: 'Buy now' }).click();
  await expect(page.getByTestId('message')).toHaveText(/^Order #\d+ confirmed — \$49\.99 charged\.$/);

  const orders = await myOrders(request, await apiLogin(request, email));
  expect(orders).toHaveLength(1);
  expect(orders[0].amount_cents).toBe(4999);
});

test('AC-03 customers always pay the listed price', { tag: '@AC-03' }, async ({ request }) => {
  const token = await apiLogin(request, uniqueEmail('tamperer'));
  const res = await request.post('/api/buy', {
    headers: { authorization: `Bearer ${token}` },
    data: { productId: 1, price: 1 },
  });
  const orders = await myOrders(request, token);
  await attachEvidence({ sent: { productId: 1, price: 1 }, response: { status: res.status(), body: await res.text() }, ordersAfterwards: orders });
  if (res.ok()) {
    expect(orders, 'an order was created, so it must be at the listed price').toHaveLength(1);
    expect(orders[0].amount_cents, 'charged amount').toBe(4999);
  } else {
    expect(orders, 'request refused, so no order may exist').toHaveLength(0);
  }
});

test('AC-04 one pair per customer, even on double-click', { tag: '@AC-04' }, async ({ page, request }) => {
  const email = uniqueEmail('double-clicker');
  await signInOnPage(page, email);
  const responses = [];
  page.on('response', (r) => r.url().endsWith('/api/buy') && responses.push(r));
  await page.getByRole('button', { name: 'Buy now' }).dblclick();
  await expect.poll(() => responses.length, { message: 'both clicks reached the server' }).toBe(2);
  await Promise.all(responses.map((r) => r.finished()));

  const orders = await myOrders(request, await apiLogin(request, email));
  expect(orders, 'orders for this customer').toHaveLength(1);
});

test('AC-05 sold-out state is clear', { tag: '@AC-05' }, async ({ page, request }) => {
  await resetSale(request, 0);
  await page.goto('/');
  await expect(page.getByTestId('stock')).toHaveText('Sold out');
  await expect(page.getByRole('button', { name: 'Sold out' })).toBeDisabled();
});

test('AC-06 orders are private', { tag: '@AC-06' }, async ({ request }) => {
  const alice = await apiLogin(request, uniqueEmail('alice'));
  const bought = await request.post('/api/buy', {
    headers: { authorization: `Bearer ${alice}` },
    data: { productId: 1, price: 4999, address: '1 Private Lane' },
  });
  expect(bought.ok(), 'test setup: Alice buys').toBeTruthy();
  const { orderId } = await bought.json();

  const bob = await apiLogin(request, uniqueEmail('bob'));
  for (const [who, headers] of [['Bob', { authorization: `Bearer ${bob}` }], ['logged-out visitor', {}]]) {
    const res = await request.get(`/api/orders/${orderId}`, { headers });
    const body = await res.text();
    await attachEvidence({ who, request: `GET /api/orders/${orderId}`, status: res.status(), body: body.slice(0, 500) });
    expect(res.status(), `${who} must be refused (HTTP 401/403/404) when asking for Alice's order`).toBeGreaterThanOrEqual(400);
    expect(body, `${who} must not see Alice's address`).not.toContain('1 Private Lane');
  }
});

test('AC-08 payment problems are explained and the pair goes back on sale', { tag: '@AC-08' }, async ({ page, request }) => {
  await resetSale(request, 1);
  await request.post(`${PAYMENT_PROVIDER}/config`, { data: { hangRate: 1 } });
  try {
    await signInOnPage(page, uniqueEmail('unlucky'));
    await page.getByRole('button', { name: 'Buy now' }).click();
    await expect(page.getByTestId('message')).toHaveText(/payment did not go through/i, { timeout: 5_000 });
    // Read stock from the admin stats (the database), not the cached product page.
    await expect
      .poll(async () => (await (await request.get('/api/admin/stats', { headers: ADMIN })).json()).stockRemaining, {
        message: 'stock released for other shoppers',
        timeout: 5_000,
      })
      .toBe(1);
  } finally {
    await request.post(`${PAYMENT_PROVIDER}/config`, { data: { hangRate: 0 } });
  }
});

test('AC-09 sale page is accessible', { tag: '@AC-09' }, async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('stock')).toHaveText('100 left');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length} element(s))`)).toEqual([]);
});

test.describe('on a phone', () => {
  const { defaultBrowserType, ...pixel7 } = devices['Pixel 7'];
  test.use(pixel7);

  test('AC-10 works on a phone', { tag: '@AC-10' }, async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Buy now' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
  });
});
