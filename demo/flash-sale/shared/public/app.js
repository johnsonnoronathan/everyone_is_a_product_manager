const PRODUCT_ID = 1;
const $ = (id) => document.getElementById(id);
let product = null;
let token = sessionStorage.getItem('token');
let email = sessionStorage.getItem('email');

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

async function loadProduct() {
  const res = await fetch(`/api/products/${PRODUCT_ID}`);
  product = await res.json();
  $('name').textContent = product.name;
  $('description').textContent = product.description;
  $('price').textContent = money(product.price_cents);
  $('stock').textContent = product.stock > 0 ? `${product.stock} left` : 'Sold out';
  const list = $('reviews');
  list.replaceChildren(
    ...product.reviews.map((r) => {
      const li = document.createElement('li');
      li.textContent = `${'★'.repeat(r.rating)} ${r.body} — ${r.author}`;
      return li;
    }),
  );
  render();
}

function render() {
  const soldOut = product && product.stock <= 0;
  $('signed-in').hidden = !token;
  $('login-form').hidden = Boolean(token);
  if (token) $('signed-in').textContent = `Signed in as ${email}`;
  $('buy').disabled = !token || soldOut;
  $('buy').textContent = soldOut ? 'Sold out' : 'Buy now';
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  email = $('email').value.trim();
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const body = await res.json();
  token = body.token;
  sessionStorage.setItem('token', token);
  sessionStorage.setItem('email', email);
  render();
});

$('buy').addEventListener('click', async () => {
  $('message').textContent = 'Placing your order…';
  const res = await fetch('/api/buy', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ productId: PRODUCT_ID, price: product.price_cents }),
  });
  const body = await res.json().catch(() => ({}));
  const messages = {
    200: () => `Order #${body.orderId} confirmed — ${money(body.amountCents)} charged.`,
    409: () => 'You already have an order for this item (limit one per customer).',
    410: () => 'Sorry, this item is sold out.',
    429: () => 'Too many attempts. Please wait a few seconds and try again.',
    503: () => body.error ?? 'We are very busy. Please try again.',
  };
  $('message').textContent = (messages[res.status] ?? (() => 'Something went wrong. Please try again.'))();
  if (res.status === 410) product.stock = 0;
  render();
});

loadProduct();
