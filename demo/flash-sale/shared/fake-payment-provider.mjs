// A stand-in for a card processor (Stripe, Adyen...). Simulated infrastructure,
// not part of the code under review.
//
// It behaves like a real provider in the ways that matter on Black Friday:
// - usually quick, but a small share of calls hang for a long time and then fail;
// - a charge that has started completes even if the caller gives up waiting
//   (the card is charged; the app just never hears about it);
// - idempotency keys: repeating a request with the same key returns the original
//   result instead of charging again, and answers 409 while the first is still running.
import http from 'node:http';

const PORT = Number(process.env.PAYMENT_PORT ?? 4100);
const config = {
  minMs: Number(process.env.PAYMENT_MIN_MS ?? 80),
  maxMs: Number(process.env.PAYMENT_MAX_MS ?? 200),
  hangRate: Number(process.env.PAYMENT_HANG_RATE ?? 0.02),
  hangMs: Number(process.env.PAYMENT_HANG_MS ?? 30_000),
  declineRate: Number(process.env.PAYMENT_DECLINE_RATE ?? 0),
};

const results = new Map(); // idempotency key -> completed result
const inFlight = new Set(); // idempotency keys being processed
let charges = 0;
let chargedCents = 0;

function send(res, status, body) {
  if (res.destroyed) return;
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJson(req, callback) {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    try {
      callback(JSON.parse(raw || '{}'));
    } catch {
      callback(null);
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/stats') return send(res, 200, { charges, chargedCents });

  // Test controls (used by acceptance and load tests): change latency, hangs and declines.
  if (req.method === 'POST' && req.url === '/config') {
    return readJson(req, (body) => {
      if (!body) return send(res, 400, { error: 'invalid json' });
      for (const key of Object.keys(config)) if (body[key] !== undefined) config[key] = Number(body[key]);
      send(res, 200, config);
    });
  }
  if (req.method === 'POST' && req.url === '/reset') {
    charges = 0;
    chargedCents = 0;
    results.clear();
    inFlight.clear();
    return send(res, 200, { ok: true });
  }
  if (req.method !== 'POST' || req.url !== '/charge') return send(res, 404, { error: 'not found' });

  readJson(req, (body) => {
    if (!body) return send(res, 400, { error: 'invalid json' });
    const key = req.headers['idempotency-key'];
    if (key && results.has(key)) return send(res, results.get(key).status, results.get(key).body);
    if (key && inFlight.has(key)) return send(res, 409, { error: 'idempotency_key_in_use' });
    if (key) inFlight.add(key);

    const hang = Math.random() < config.hangRate;
    const delay = hang ? config.hangMs : config.minMs + Math.random() * (config.maxMs - config.minMs);
    setTimeout(() => {
      if (key) inFlight.delete(key);
      // A hung call fails without charging; the caller may retry with the same key.
      if (hang) return send(res, 504, { error: 'upstream timeout' });
      let result;
      if (Math.random() < config.declineRate) {
        result = { status: 402, body: { error: 'card_declined' } };
      } else {
        charges++;
        chargedCents += Number(body.amountCents) || 0;
        result = { status: 200, body: { chargeId: `ch_${charges}`, amountCents: body.amountCents, status: 'succeeded' } };
      }
      if (key) results.set(key, result);
      // Completed even if the caller already hung up, like a real provider.
      send(res, result.status, result.body);
    }, delay);
  });
});

server.listen(PORT, () => console.log(`fake payment provider listening on http://127.0.0.1:${PORT}`));
