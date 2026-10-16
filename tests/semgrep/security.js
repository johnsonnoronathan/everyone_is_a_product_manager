// Fixtures for .claude/skills/launch-review/semgrep/security.yml (semgrep --test annotations).
const child_process = require('child_process');

async function handlers(db, req, res, prisma, q) {
  // ruleid: sql-built-from-strings-js
  await db.query(`SELECT * FROM users WHERE name = '${q}'`);
  // ruleid: sql-built-from-strings-js
  await db.query("SELECT * FROM users WHERE id = " + req.params.id);
  // ok: sql-built-from-strings-js
  await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  // ok: sql-built-from-strings-js
  await prisma.$queryRaw`SELECT * FROM users WHERE id = ${q}`;

  // ruleid: command-injection-js
  child_process.exec(`convert ${req.query.file} out.png`);
  // ok: command-injection-js
  db.exec('CREATE TABLE t (id int)');

  // ruleid: price-from-client
  const { productId, price } = req.body;
  // ruleid: price-from-client
  const { amount } = await req.json();
  // ok: price-from-client
  const { quantity } = req.body;

  // ruleid: unverified-token-decode
  const user = JSON.parse(Buffer.from(req.headers.token, 'base64').toString());
  // ruleid: unverified-token-decode
  const claims = jwt.decode(req.headers.authorization);

  // ruleid: insecure-randomness-for-secrets
  const resetToken = Math.random().toString(36).slice(2);
  // ok: insecure-randomness-for-secrets
  const jitter = Math.random() * 100;

  // ruleid: cookie-without-flags
  res.cookie('session', 'abc');
  // ok: cookie-without-flags
  res.cookie('session', 'abc', { httpOnly: true, secure: true, sameSite: 'lax' });

  // ruleid: cors-wildcard
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ruleid: tls-verification-disabled
  const agent = new https.Agent({ rejectUnauthorized: false });

  try {
    await db.query('SELECT 1');
  } catch (err) {
    // ruleid: stack-trace-to-client
    res.status(500).send(err.stack);
  }

  req.on('end', () => {
    // ruleid: json-parse-in-stream-callback
    const body = JSON.parse(data);
  });
  req.on('end', () => {
    try {
      // ok: json-parse-in-stream-callback
      const body = JSON.parse(data);
    } catch (e) {}
  });
}

async function saveOrder(db) {
  // ruleid: swallowed-error-fake-success
  try {
    await db.insert();
    return { success: true };
  } catch (e) {
    return { success: true };
  }
}

const routes = {
  // ruleid: admin-route-inventory
  'POST /api/admin/reset': () => {},
  // ok: admin-route-inventory
  'GET /api/products': () => {},
};
