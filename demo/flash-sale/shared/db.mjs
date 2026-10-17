// Shared database layer for both demo variants. This file simulates infrastructure;
// it is not part of the code under review.
//
// The data lives in SQLite, but every query has to borrow one of a fixed number of
// connections and pays a simulated network round-trip, the way a hosted Postgres
// (Supabase, Neon, RDS...) behaves. Without this, in-process SQLite is so fast that
// the demo would hide the exact problems that sink real flash sales: too many
// queries per page and a connection pool that runs dry.
import { DatabaseSync } from 'node:sqlite';

export class PoolTimeoutError extends Error {
  constructor() {
    super('Timed out waiting for a free database connection');
    this.name = 'PoolTimeoutError';
  }
}

export const SQLITE_CONSTRAINT_UNIQUE = 2067;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function openDb({
  file = ':memory:',
  poolSize = Number(process.env.DB_POOL_SIZE ?? 10),
  latencyMs = Number(process.env.DB_LATENCY_MS ?? 3),
  acquireTimeoutMs = 0, // 0 = wait forever, the default in most Postgres drivers
} = {}) {
  const sqlite = new DatabaseSync(file);
  const statements = new Map();
  const prepare = (sql) => {
    let stmt = statements.get(sql);
    if (!stmt) {
      stmt = sqlite.prepare(sql);
      statements.set(sql, stmt);
    }
    return stmt;
  };

  let free = poolSize;
  const waiters = [];

  function acquire(timeoutMs) {
    if (free > 0) {
      free--;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, timer: null };
      if (timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new PoolTimeoutError());
        }, timeoutMs);
      }
      waiters.push(waiter);
    });
  }

  function release() {
    const next = waiters.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve();
    } else {
      free++;
    }
  }

  async function withConnection(fn, timeoutMs = acquireTimeoutMs) {
    await acquire(timeoutMs);
    try {
      await sleep(latencyMs);
      return fn();
    } finally {
      release();
    }
  }

  // Wraps the raw handle so code inside transaction() uses the same API, minus the latency.
  const tx = {
    get: (sql, ...params) => prepare(sql).get(...params),
    all: (sql, ...params) => prepare(sql).all(...params),
    run: (sql, ...params) => prepare(sql).run(...params),
  };

  return {
    get: (sql, ...params) => withConnection(() => tx.get(sql, ...params)),
    all: (sql, ...params) => withConnection(() => tx.all(sql, ...params)),
    run: (sql, ...params) => withConnection(() => tx.run(sql, ...params)),
    // Runs fn synchronously inside BEGIN IMMEDIATE ... COMMIT on one connection.
    // Pass { acquireTimeoutMs: 0 } to wait as long as it takes for a connection.
    transaction: (fn, { acquireTimeoutMs: timeoutMs = acquireTimeoutMs } = {}) =>
      withConnection(() => {
        sqlite.exec('BEGIN IMMEDIATE');
        try {
          const result = fn(tx);
          sqlite.exec('COMMIT');
          return result;
        } catch (err) {
          sqlite.exec('ROLLBACK');
          throw err;
        }
      }, timeoutMs),
    // Schema setup only; bypass the pool.
    exec: (sql) => sqlite.exec(sql),
    prepare: (sql) => sqlite.prepare(sql),
    poolStats: () => ({ poolSize, inUse: poolSize - free, waiting: waiters.length }),
  };
}
