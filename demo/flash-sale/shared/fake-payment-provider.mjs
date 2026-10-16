// A stand-in for a card processor (Stripe, Adyen...). Simulated infrastructure,
// not part of the code under review.
//
// Like a real provider on Black Friday it is usually quick, but a small share of
// calls hang for a long time. Apps that call it without a timeout pile up stuck requests.
import http from 'node:http';

const PORT = Number(process.env.PAYMENT_PORT ?? 4100);
const MIN_MS = Number(process.env.PAYMENT_MIN_MS ?? 80);
const MAX_MS = Number(process.env.PAYMENT_MAX_MS ?? 200);
const HANG_RATE = Number(process.env.PAYMENT_HANG_RATE ?? 0.02);
const HANG_MS = Number(process.env.PAYMENT_HANG_MS ?? 30_000);

const byIdempotencyKey = new Map();
let charges = 0;
let chargedCents = 0;

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/stats') return send(res, 200, { charges, chargedCents });
  if (req.method === 'POST' && req.url === '/reset') {
    charges = 0;
    chargedCents = 0;
    byIdempotencyKey.clear();
    return send(res, 200, { ok: true });
  }
  if (req.method !== 'POST' || req.url !== '/charge') return send(res, 404, { error: 'not found' });

  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return send(res, 400, { error: 'invalid json' });
    }
    const key = req.headers['idempotency-key'];
    if (key && byIdempotencyKey.has(key)) return send(res, 200, byIdempotencyKey.get(key));

    const hang = Math.random() < HANG_RATE;
    const delay = hang ? HANG_MS : MIN_MS + Math.random() * (MAX_MS - MIN_MS);
    setTimeout(() => {
      if (res.destroyed) return;
      if (hang) return send(res, 504, { error: 'upstream timeout' });
      charges++;
      chargedCents += Number(body.amountCents) || 0;
      const result = { chargeId: `ch_${charges}`, amountCents: body.amountCents, status: 'succeeded' };
      if (key) byIdempotencyKey.set(key, result);
      send(res, 200, result);
    }, delay);
  });
});

server.listen(PORT, () => console.log(`fake payment provider listening on http://127.0.0.1:${PORT}`));
