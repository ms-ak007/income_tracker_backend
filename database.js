/**
 * database.js — SQLite via sql.js (pure JavaScript, no native compilation)
 * Persists data to disk as a binary .db file.
 */

const path = require('path');
const fs   = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH  = path.join(DATA_DIR, 'tracker.db');

let db = null;
let SQL = null;

// ── Persist DB to disk ─────────────────────────────────────────────────────────
function saveToDisk() {
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) {
    console.error('DB save error:', e.message);
  }
}

// ── Auto-save every 10 seconds (safety net) ────────────────────────────────────
let autoSaveInterval = null;

function startAutoSave() {
  if (autoSaveInterval) return;
  autoSaveInterval = setInterval(saveToDisk, 10_000);
}

// ── Initialize ─────────────────────────────────────────────────────────────────
async function initDb() {
  if (db) return db;

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  SQL = await require('sql.js')();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('✅ Loaded existing database from', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('✅ Created new database at', DB_PATH);
  }

  createSchema();
  startAutoSave();

  // Save on clean exit
  process.on('exit',    saveToDisk);
  process.on('SIGINT',  () => { saveToDisk(); process.exit(0); });
  process.on('SIGTERM', () => { saveToDisk(); process.exit(0); });

  return db;
}

// ── Schema ─────────────────────────────────────────────────────────────────────
function createSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      email         TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      created_at    TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      type        TEXT    NOT NULL,
      category    TEXT    NOT NULL,
      amount      REAL    NOT NULL,
      description TEXT    DEFAULT '',
      date        TEXT    NOT NULL,
      paid_from   TEXT    DEFAULT NULL,
      created_at  TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Migration: add paid_from column to existing databases that don't have it yet
  try { db.run(`ALTER TABLE transactions ADD COLUMN paid_from TEXT DEFAULT NULL`); } catch (_) {}

  // Migration: add bank polling columns to user_settings
  try { db.run(`ALTER TABLE user_settings ADD COLUMN bank_last_polled TEXT DEFAULT NULL`); } catch (_) {}
  try { db.run(`ALTER TABLE user_settings ADD COLUMN bank_last_count INTEGER DEFAULT 0`); } catch (_) {};
  try { db.run(`ALTER TABLE user_settings ADD COLUMN bank_last_error TEXT DEFAULT NULL`); } catch (_) {};

  db.run(`CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date)`);

  // ── Automation tables ────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id        INTEGER PRIMARY KEY,
      notify_email   TEXT    DEFAULT NULL,
      budget_alert   INTEGER DEFAULT 1,
      monthly_report INTEGER DEFAULT 1,
      daily_digest   INTEGER DEFAULT 0,
      bank_parser    INTEGER DEFAULT 0,
      global_budget  REAL    DEFAULT NULL,
      imap_user      TEXT    DEFAULT NULL,
      imap_pass      TEXT    DEFAULT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS budget_caps (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id   INTEGER NOT NULL,
      category  TEXT    NOT NULL,
      amount    REAL    NOT NULL,
      UNIQUE(user_id, category),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS recurring_transactions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL,
      type         TEXT    NOT NULL,
      category     TEXT    NOT NULL,
      amount       REAL    NOT NULL,
      description  TEXT    DEFAULT '',
      paid_from    TEXT    DEFAULT NULL,
      day_of_month INTEGER DEFAULT 1,
      active       INTEGER DEFAULT 1,
      last_run     TEXT    DEFAULT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // ── AI & Policy tables ─────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS spending_policies (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      rule_type  TEXT    NOT NULL,
      category   TEXT    DEFAULT NULL,
      threshold  REAL    DEFAULT NULL,
      period     TEXT    DEFAULT 'month',
      action     TEXT    DEFAULT 'flag',
      active     INTEGER DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS policy_flags (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL,
      transaction_id INTEGER,
      rule_id        INTEGER,
      reason         TEXT,
      resolved       INTEGER DEFAULT 0,
      created_at     TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ai_log_cache (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      input_text  TEXT,
      result_json TEXT,
      source      TEXT    DEFAULT 'text',
      created_at  TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tax_tags (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL,
      transaction_id INTEGER NOT NULL,
      tax_section    TEXT    DEFAULT NULL,
      is_deductible  INTEGER DEFAULT 0,
      UNIQUE(user_id, transaction_id),
      FOREIGN KEY (user_id)        REFERENCES users(id),
      FOREIGN KEY (transaction_id) REFERENCES transactions(id)
    )
  `);
}

// ── Helper: run a query that doesn't return rows ───────────────────────────────
function run(sql, params = []) {
  // Use a statement to run the query
  const stmt = db.prepare(sql);
  stmt.run(params);
  stmt.free();

  // Capture last_insert_rowid BEFORE saving (save doesn't affect it)
  let lastInsertRowid = null;
  const ridRes = db.exec('SELECT last_insert_rowid()');
  if (ridRes.length && ridRes[0].values.length) {
    lastInsertRowid = ridRes[0].values[0][0];
  }

  saveToDisk(); // persist every write immediately
  return { lastInsertRowid };
}

// ── Helper: get one row ────────────────────────────────────────────────────────
function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

// ── Helper: get all rows ───────────────────────────────────────────────────────
function all(sql, params = []) {
  const res = db.exec(sql, params);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

module.exports = { initDb, run, get, all, saveToDisk };
