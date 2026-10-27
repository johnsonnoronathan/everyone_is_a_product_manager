// One test per acceptance criterion in ../criteria.md (v1.1). Each test is tagged with its
// AC id so the report can trace criterion → test → result → evidence.
import fs from 'node:fs';
import { test, expect, devices } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ADMIN = { 'x-admin-token': 'demo-admin-token' };
const PAYMENT_PROVIDER = `http://127.0.0.1:${process.env.PAYMENT_PORT ?? '4100'}`;
let counter = 0;
const uniqueEmail = (name) => `${name}-${Date.now()}-${counter++}@acceptance.test`;
const uniqueAddress = () => `${Date.now() % 100000}-${counter++} Acceptance Avenue, Testville`;
const auth = (token) => ({ authorization: `Bearer ${token}` });

async function resetSale(request, stock = 100) {
  const res = await request.post('/api/admin/reset', { headers: ADMIN, data: { stock } });
  expect(res.ok(), 'test setup: reset sale data').toBeTruthy();
}

async function setSale(request, settings) {
  const res = await request.post('/api/admin/sale', { headers: ADMIN, data: settings });
  expect(res.ok(), `test setup: change sale settings ${JSON.stringify(settings)} (HTTP ${res.status()})`).toBeTruthy();
}

async function apiLogin(request, email) {
  const res = await request.post('/api/login', { data: { email } });
  return (await res.json()).token;
}

async function apiBuy(request, token, data = {}) {
  return request.post('/api/buy', { headers: auth(token), data: { productId: 1, price: 4999, address: uniqueAddress(), ...data } });
}

async function signInOnPage(page, email) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
}

async function myOrders(request, token) {
  const res = await request.get('/api/my-orders', { headers: auth(token) });
  return res.json();
}

// API-level tests have no screenshot, so save what was sent and received as evidence.
async function attachEvidence(data) {
  const file = test.info().outputPath('evidence.json');
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  await test.info().attach('evidence', { path: file, contentType: 'application/json' });
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
  await page.getByLabel('Shipping address').fill(uniqueAddress());
  await page.getByRole('button', { name: 'Buy now' }).click();
  await expect(page.getByTestId('message')).toHaveText(/^Order #\d+ confirmed — \$49\.99 charged\.$/);

  const orders = await myOrders(request, await apiLogin(request, email));
  expect(orders).toHaveLength(1);
  expect(orders[0].amount_cents).toBe(4999);
});

test('AC-03 customers always pay the listed price', { tag: '@AC-03' }, async ({ request }) => {
  const token = await apiLogin(request, uniqueEmail('tamperer'));
  const res = await apiBuy(request, token, { price: 1 });
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
  await page.getByLabel('Shipping address').fill(uniqueAddress());
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
  const bought = await apiBuy(request, alice, { address: '1 Private Lane, Springfield' });
  expect(bought.ok(), 'test setup: Alice buys').toBeTruthy();
  const { orderId } = await bought.json();

  const bob = await apiLogin(request, uniqueEmail('bob'));
  for (const [who, headers] of [['Bob', auth(bob)], ['logged-out visitor', {}]]) {
    const res = await request.get(`/api/orders/${orderId}`, { headers });
    const body = await res.text();
    await attachEvidence({ who, request: `GET /api/orders/${orderId}`, status: res.status(), body: body.slice(0, 500) });
    expect(res.status(), `${who} must be refused (HTTP 401/403/404) when asking for Alice's order`).toBeGreaterThanOrEqual(400);
    expect(body, `${who} must not see Alice's address`).not.toContain('1 Private Lane');
  }
});

test('AC-08 slow or failing payments never charge twice or lose the pair', { tag: '@AC-08' }, async ({ page, request }) => {
  await resetSale(request, 1);
  await request.post(`${PAYMENT_PROVIDER}/config`, { data: { hangRate: 1 } });
  try {
    const email = uniqueEmail('unlucky');
    await signInOnPage(page, email);
    await page.getByLabel('Shipping address').fill(uniqueAddress());
    await page.getByRole('button', { name: 'Buy now' }).click();
    await expect(page.getByTestId('message')).toHaveText(/confirming your payment/i, { timeout: 5_000 });

    // The provider recovers. The shopper must end up with exactly one paid order and one charge.
    await request.post(`${PAYMENT_PROVIDER}/config`, { data: { hangRate: 0 } });
    const token = await apiLogin(request, email);
    await expect.poll(async () => (await myOrders(request, token)).length, { message: 'paid orders for this shopper', timeout: 20_000 }).toBe(1);
    const stats = await (await request.get('/api/admin/stats', { headers: ADMIN })).json();
    await attachEvidence({ stats });
    expect(stats.payments.charges, 'times the provider charged').toBe(1);
    await expect(page.getByTestId('message')).toHaveText(/^Order #\d+ confirmed/, { timeout: 10_000 });
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

test('AC-11 every order has a shipping address', { tag: '@AC-11' }, async ({ page, request }) => {
  const email = uniqueEmail('no-address');
  await signInOnPage(page, email);
  await page.getByRole('button', { name: 'Buy now' }).click();
  await expect(page.getByTestId('message')).toHaveText(/shipping address/i);

  const token = await apiLogin(request, email);
  const res = await request.post('/api/buy', { headers: auth(token), data: { productId: 1, price: 4999 } });
  await attachEvidence({ sent: { productId: 1, price: 4999 }, status: res.status(), body: await res.text() });
  expect(res.status(), 'a purchase without an address must be refused').toBe(400);
  expect(await myOrders(request, token), 'orders created without an address').toHaveLength(0);
});

test('AC-12 nobody can buy before the sale opens', { tag: '@AC-12' }, async ({ page, request }) => {
  await setSale(request, { startsAt: new Date(Date.now() + 60 * 60_000).toISOString() });
  const email = uniqueEmail('early-bird');
  await signInOnPage(page, email);
  await expect(page.getByTestId('sale-status')).toHaveText(/opens at/i);
  await expect(page.getByRole('button', { name: 'Not open yet' })).toBeDisabled();

  const token = await apiLogin(request, email);
  const res = await apiBuy(request, token);
  await attachEvidence({ status: res.status(), body: await res.text() });
  expect(res.status(), 'a purchase before the opening time must be refused').toBe(403);
  expect(await myOrders(request, token)).toHaveLength(0);
});

test('AC-13 the sale can be paused without losing orders', { tag: '@AC-13' }, async ({ request }) => {
  const early = await apiLogin(request, uniqueEmail('before-pause'));
  expect((await apiBuy(request, early)).ok(), 'test setup: a shopper buys before the pause').toBeTruthy();

  await setSale(request, { paused: true });
  const during = await apiBuy(request, await apiLogin(request, uniqueEmail('during-pause')));
  const duringBody = await during.text();
  expect(during.status(), 'purchase while paused').toBe(403);
  expect(duringBody).toMatch(/paused/i);
  expect(await myOrders(request, early), 'the earlier order survives the pause').toHaveLength(1);

  await setSale(request, { paused: false });
  const after = await apiBuy(request, await apiLogin(request, uniqueEmail('after-pause')));
  await attachEvidence({ duringPause: { status: during.status(), body: duringBody }, afterResume: { status: after.status() } });
  expect(after.ok(), 'purchase after resuming').toBeTruthy();
});
