// OPS-09: what "redeploy the previous release" (RUNBOOK.md, Levers) does to a database that the
// current release has migrated. Replays the previous release's start-up statements, copied verbatim
// from `git show d572634:demo/flash-sale/fixed/server.mjs` lines 42-54, against a COPY of a local
// demo database file. Usage: node rollback-ddl.mjs <db-file>
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const copy = `${process.argv[2]}.rollback-copy`;
fs.copyFileSync(process.argv[2], copy);
const db = new DatabaseSync(copy);
const before = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
console.log(`orders in the database before the old start-up: ${before}`);
try {
  db.exec(`
  CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, price_cents INTEGER NOT NULL, stock INTEGER NOT NULL CHECK (stock >= 0), initial_stock INTEGER NOT NULL);
  CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);`);
  console.log('old CREATE TABLE statements: succeeded');
} catch (err) {
  console.log(`old CREATE TABLE statements: ${err.message}  -> the previous release exits at start-up`);
}
try {
  db.prepare("INSERT INTO orders (product_id, customer, amount_cents, address, status, created_at) VALUES (1, 'x@example.com', 4999, 'x', 'pending', datetime('now'))").run();
  console.log('old order INSERT: succeeded');
} catch (err) {
  console.log(`old order INSERT (if it got that far): ${err.message}`);
}
// The old start-up would then run seed(): this is the statement it executes first.
console.log("old seed() would run next: DELETE FROM products; DELETE FROM users; DELETE FROM reviews; DELETE FROM orders;");
db.close();
fs.rmSync(copy);
