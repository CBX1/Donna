const db = require('../db');

const getByIdStmt = db.prepare('SELECT * FROM users WHERE id = ?');
const upsertStmt = db.prepare(`
  INSERT INTO users (id, display_name, is_admin) VALUES (?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET display_name = ?, updated_at = datetime('now')
`);
const updateStmt = db.prepare(`UPDATE users SET updated_at = datetime('now') WHERE id = ?`);
const listAllStmt = db.prepare('SELECT * FROM users WHERE onboarding_complete = 1');
const listAdminsStmt = db.prepare('SELECT * FROM users WHERE is_admin = 1');

function getById(userId) {
  return getByIdStmt.get(userId) || null;
}

function getOrCreate(userId, displayName, isAdmin = 0) {
  const existing = getByIdStmt.get(userId);
  if (existing) return existing;
  upsertStmt.run(userId, displayName, isAdmin, displayName);
  return getByIdStmt.get(userId);
}

function update(userId, fields) {
  const allowed = ['display_name', 'slack_user_token', 'google_refresh_token', 'google_access_token',
    'google_token_expiry', 'github_username', 'notion_database_id', 'timezone', 'is_admin',
    'onboarding_complete', 'daily_summary_time'];
  const sets = [];
  const values = [];
  for (const [key, val] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  values.push(userId);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

function isAdmin(userId) {
  const user = getByIdStmt.get(userId);
  return user?.is_admin === 1;
}

function listOnboarded() {
  return listAllStmt.all();
}

function listAll() {
  return db.prepare('SELECT * FROM users').all();
}

module.exports = { getById, getOrCreate, update, isAdmin, listOnboarded, listAll };
