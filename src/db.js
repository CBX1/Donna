const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const log = require('./utils/logger').child({ module: 'db' });

const DB_PATH = path.resolve(__dirname, '..', 'donna.db');
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Run existing table creation (backwards compat)
db.exec(`
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    trigger_at TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS last_queried (
    user_id TEXT PRIMARY KEY,
    queried_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS triage_last_processed (
    channel_id TEXT PRIMARY KEY,
    last_ts TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
  );
`);

// Run migration files
const applied = new Set(db.prepare('SELECT name FROM _migrations').all().map(r => r.name));
const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

for (const file of files) {
  if (applied.has(file)) continue;
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  db.exec(sql);
  db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
  log.info({ file }, 'Migration applied');
}

module.exports = db;
