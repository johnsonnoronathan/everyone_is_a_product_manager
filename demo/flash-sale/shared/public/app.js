const PRODUCT_ID = 1;
const $ = (id) => document.getElementById(id);
let product = null;
let token = sessionStorage.getItem('token');
let email = sessionStorage.getItem('email');
let clockOffset = 0; // server clock minus this device's clock
let refreshTimer = null;

const money = (cents) => `$${(cents / 100).toFixed(2)}`;
// Every request gives up after 15 s, so the page never waits forever on a stuck connection.
const api = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(15_000) });
const jitter = (ms) => ms + Math.random() * ms * 0.25;
const setMessage = (text) => ($('message').textContent = text);

async function loadProduct(attempt = 0) {
  clearTimeout(refreshTimer);
  try {
    const res = await api(`/api/products/${PRODUCT_ID}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    product = await res.json();
  } catch {
    // Busy or briefly unreachable: say so and retry with backoff instead of hanging on "Loading…".
    if (!product) $('name').textContent = 'We are very busy. Retrying…';
    refreshTimer = setTimeout(() => loadProduct(attempt + 1), jitter(Math.min(10_000, 1000 * 2 ** attempt)));
    return;
  }
  if (product.sale?.serverTime) clockOffset = Date.parse(product.sale.serverTime) - Date.now();
  $('name').textContent = product.name;
  $('description').textContent = product.description;
  $('price').textContent = money(product.price_cents);
  $('stock').textContent = product.stock > 0 ? `${product.stock} left` : 'Sold out';
  $('reviews').replaceChildren(
    ...product.reviews.map((r) => {
      const li = document.createElement('li');
      li.textContent = `${'★'.repeat(r.rating)} ${r.body} — ${r.author}`;
      return li;
    }),
  );
  render();
  scheduleRefresh();
}

// Re-check when the sale opens, while it's paused, and while sold out (pairs from failed payments can come back).
function scheduleRefresh() {
  const sale = product.sale;
  const opensIn = sale?.startsAt ? Date.parse(sale.startsAt) - (Date.now() + clockOffset) : 0;
  if (opensIn > 0) refreshTimer = setTimeout(loadProduct, opensIn + Math.random() * 2000);
  else if (sale?.paused) refreshTimer = setTimeout(loadProduct, jitter(15_000));
  else if (product.stock <= 0) refreshTimer = setTimeout(loadProduct, jitter(20_000));
}

function saleStatus() {
  const sale = product?.sale;
  if (!sale) return { open: true, text: '' };
  if (sale.paused) return { open: false, text: 'The sale is paused. Please check back in a few minutes.' };
  if (sale.startsAt && Date.parse(sale.startsAt) > Date.now() + clockOffset) {
    return { open: false, text: `The sale opens at ${new Date(sale.startsAt).toLocaleString()}.` };
  }
  return { open: true, text: '' };
}

function render() {
  const soldOut = product && product.stock <= 0;
  const status = saleStatus();
  $('sale-status').textContent = status.text;
  $('signed-in').hidden = !token;
  $('login-form').hidden = Boolean(token);
  $('checkout-fields').hidden = !token;
  if (token) $('signed-in').textContent = `Signed in as ${email}`;
  $('buy').disabled = !token || soldOut || !status.open;
  $('buy').textContent = soldOut ? 'Sold out' : status.open ? 'Buy now' : 'Not open yet';
}

function signOut(message) {
  token = null;
  sessionStorage.removeItem('token');
  render();
  setMessage(message);
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  email = $('email').value.trim();
  const res = await api('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.token) return setMessage(body.error ?? 'Sign-in failed. Please try again.');
  token = body.token;
  sessionStorage.setItem('token', token);
  sessionStorage.setItem('email', email);
  setMessage('');
  render();
});

// After "confirming", poll the order until the payment outcome is known. Never ask to pay again.
async function followOrder(orderId) {
  const deadline = Date.now() + 2 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const res = await api(`/api/orders/${orderId}`, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
    if (!res?.ok) continue;
    const order = await res.json();
    if (order.status === 'paid') return setMessage(`Order #${order.id} confirmed — ${money(order.amount_cents)} charged.`);
    if (order.status === 'payment_failed') return setMessage('Payment did not go through. You have not been charged.');
  }
  setMessage("We're still confirming your payment. We'll email you as soon as it's done. Please don't pay again.");
}

$('buy').addEventListener('click', async () => {
  const address = $('address').value.trim();
  if (address.length < 10) return setMessage('Please enter your full shipping address.');
  setMessage('Placing your order…');
  let res;
  try {
    res = await api('/api/buy', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ productId: PRODUCT_ID, price: product.price_cents, address }),
    });
  } catch {
    return setMessage('Connection problem. Check your order history before trying again.');
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 200) setMessage(`Order #${body.orderId} confirmed — ${money(body.amountCents)} charged.`);
  else if (res.status === 202) {
    setMessage(body.message ?? "We're confirming your payment. Please don't pay again.");
    followOrder(body.orderId);
  } else if (res.status === 401) signOut('Your session has expired. Please sign in again.');
  else if (res.status === 409) setMessage(body.error ?? 'You already have an order for this item (limit one per customer).');
  else if (res.status === 410) {
    setMessage('Sorry, this item is sold out right now. Pairs from failed payments sometimes come back, so we will keep checking.');
    product.stock = 0;
  } else if (res.status === 429) setMessage('Too many attempts. Please wait a few seconds and try again.');
  else if ([400, 402, 403, 503].includes(res.status)) setMessage(body.error ?? 'We are very busy. Please try again.');
  else setMessage('Something went wrong. Please try again.');
  render();
  if (res.status === 410 || res.status === 403) scheduleRefresh();
});

loadProduct();
