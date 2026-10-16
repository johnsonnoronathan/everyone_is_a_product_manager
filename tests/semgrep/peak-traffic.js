// Fixtures for .claude/skills/peak-traffic-test/semgrep/peak-traffic.yml
const fs = require('fs');

async function buy(db, product, prisma, items, axios) {
  // ruleid: stock-lost-update-sql
  await db.run('UPDATE products SET stock = ? WHERE id = ?', product.stock - 1, product.id);
  // ok: stock-lost-update-sql
  await db.run('UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0', product.id);

  // ruleid: stock-lost-update-orm-js
  await prisma.product.update({ where: { id: 1 }, data: { stock: product.stock - 1 } });
  // ok: stock-lost-update-orm-js
  await prisma.product.update({ where: { id: 1 }, data: { stock: { decrement: 1 } } });
  // ok: stock-lost-update-orm-js
  bucket.tokens -= 1;

  for (const item of items) {
    // ruleid: db-query-in-loop-js
    item.price = await db.get('SELECT price FROM prices WHERE id = ?', item.id);
  }
  // ok: db-query-in-loop-js
  const prices = await db.all('SELECT * FROM prices WHERE id IN (?)', items.map((i) => i.id));

  // ruleid: fetch-without-timeout
  await fetch('https://payments.example/charge', { method: 'POST' });
  // ok: fetch-without-timeout
  await fetch('https://payments.example/charge', { method: 'POST', signal: AbortSignal.timeout(3000) });

  // ruleid: axios-without-timeout
  await axios.get('https://api.example/rates');
  // ok: axios-without-timeout
  await axios.get('https://api.example/rates', { timeout: 2000 });

  // ruleid: email-in-request-path
  await sendConfirmationEmail(product);
  // ok: email-in-request-path
  queue.add('email', product);
}

const handler = async (req, res) => {
  // ruleid: sync-io-in-request-handler
  const html = fs.readFileSync('index.html');
  res.end(html);
};
// ok: sync-io-in-request-handler
const template = fs.readFileSync('index.html');
