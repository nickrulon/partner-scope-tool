// Persistent store for accounts + purchase entitlements.
// SQLite (better-sqlite3) on disk — the file lives on a persistent volume in
// production (GOOSE_DB env) so purchases survive restarts and deploys.
// Falls back to in-memory maps if sqlite isn't available (dev/tests still run).
//
// Data model:
//   accounts:      one row per player identity (anonymous device accounts —
//                  the app generates a stable id, no sign-up).
//   entitlements:  one row per owned product (host_pass, future expansion
//                  packs), keyed to the account. txn_id is the App Store
//                  transaction id — UNIQUE so a replayed receipt can't grant
//                  the same purchase twice.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.GOOSE_DB || path.join(__dirname, 'data', 'goose.db');

// Products we sell. The catalog is the single source of truth for what an
// entitlement id means; App Store product ids map 1:1 onto these.
export const PRODUCTS = {
  host_pass: { name: 'Host Pass', kind: 'entitlement' },
  // future expansion packs register here, e.g.:
  // pack_barnyard: { name: 'Barnyard Pack', kind: 'pack' },
};

let db = null;
// in-memory fallback
const memAccounts = new Map();      // id -> account row
const memEntitlements = new Map();  // accountId -> Map(productId -> row)
const memTxns = new Set();

try {
  const { default: Database } = await import('better-sqlite3');
  if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      platform TEXT,
      created_at INTEGER,
      last_seen INTEGER
    );
    CREATE TABLE IF NOT EXISTS entitlements (
      account_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      platform TEXT,
      txn_id TEXT UNIQUE,
      created_at INTEGER,
      PRIMARY KEY (account_id, product_id)
    );
  `);
} catch (e) {
  console.warn('goose store: better-sqlite3 unavailable, using in-memory store (purchases will NOT persist):', e.message);
}

const now = () => Date.now();

// Fetch or create the account for a client-supplied id. Ids are opaque; the
// server only cares that they're stable per device/install.
export function touchAccount(id, platform = 'web') {
  if (db) {
    db.prepare(`INSERT INTO accounts (id, platform, created_at, last_seen) VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen`)
      .run(id, platform, now(), now());
    return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  }
  const acct = memAccounts.get(id) || { id, platform, created_at: now() };
  acct.last_seen = now();
  memAccounts.set(id, acct);
  return acct;
}

// Grant a product to an account. Returns false when the transaction id was
// already consumed (replay) — callers treat that as "no new grant".
export function grantEntitlement(accountId, productId, { platform = 'ios', txnId = null } = {}) {
  if (!PRODUCTS[productId]) return false;
  if (db) {
    try {
      db.prepare(`INSERT INTO entitlements (account_id, product_id, platform, txn_id, created_at)
                  VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(account_id, product_id) DO NOTHING`)
        .run(accountId, productId, platform, txnId, now());
      return true;
    } catch (e) {
      return false;   // txn_id UNIQUE violation → replayed receipt
    }
  }
  if (txnId && memTxns.has(txnId)) return false;
  if (txnId) memTxns.add(txnId);
  const mine = memEntitlements.get(accountId) || new Map();
  if (!mine.has(productId)) mine.set(productId, { product_id: productId, platform, txn_id: txnId, created_at: now() });
  memEntitlements.set(accountId, mine);
  return true;
}

export function getEntitlements(accountId) {
  if (!accountId) return [];
  if (db) {
    return db.prepare('SELECT product_id FROM entitlements WHERE account_id = ?')
      .all(accountId).map((r) => r.product_id);
  }
  return [...(memEntitlements.get(accountId)?.keys() || [])];
}

export function hasEntitlement(accountId, productId) {
  if (!accountId) return false;
  if (db) {
    return !!db.prepare('SELECT 1 FROM entitlements WHERE account_id = ? AND product_id = ?')
      .get(accountId, productId);
  }
  return !!memEntitlements.get(accountId)?.has(productId);
}
