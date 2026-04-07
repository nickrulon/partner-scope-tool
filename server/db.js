import { createRequire } from 'module';
import { DB_PATH } from './paths.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const dbPath = DB_PATH;
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    customer_name TEXT NOT NULL,
    partner_company TEXT NOT NULL,
    partner_name TEXT NOT NULL,
    partner_email TEXT NOT NULL,
    pam_name TEXT NOT NULL,
    deal_id TEXT,
    contract_filename TEXT NOT NULL,
    contract_path TEXT NOT NULL,
    extracted_fields TEXT,
    confirmed_fields TEXT,
    ack_cgi INTEGER DEFAULT 0,
    ack_timeline INTEGER DEFAULT 0,
    ack_ticketing INTEGER DEFAULT 0,
    ack_scope INTEGER DEFAULT 0,
    ack_responsibilities INTEGER DEFAULT 0,
    partner_signature TEXT,
    signature_timestamp DATETIME,
    signature_ip TEXT,
    status TEXT DEFAULT 'draft',
    output_pdf_path TEXT,
    submitted_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS pam_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER REFERENCES submissions(id),
    pam_name TEXT,
    received_at DATETIME,
    notes TEXT
  );
`);

// Migration: add ack_responsibilities to existing DBs that don't have it yet
try {
  db.exec(`ALTER TABLE submissions ADD COLUMN ack_responsibilities INTEGER DEFAULT 0`);
} catch (e) {
  // Column already exists — ignore
}

export default db;
