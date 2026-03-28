const db = require('../db');

// Terminal states — PR is truly done, remove from tracking
const TERMINAL_STATES = ['removed', 'closed', 'merged'];

function upsert(userId, { prUrl, title, author, detectedFrom }) {
  const existing = db.prepare('SELECT id, status FROM pr_tracking WHERE user_id = ? AND pr_url = ?').get(userId, prUrl);

  if (existing) {
    if (TERMINAL_STATES.includes(existing.status)) {
      // Was removed/closed/merged — re-open since it's being tracked again
      db.prepare(
        "UPDATE pr_tracking SET status = 'pending', title = ?, author = ?, detected_from = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(title, author, detectedFrom || 'dm', existing.id);
      return true;
    }
    // pending or reviewed — already tracked, just update title/author
    db.prepare(
      "UPDATE pr_tracking SET title = ?, author = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(title, author, existing.id);
    return false;
  }

  db.prepare(`
    INSERT INTO pr_tracking (user_id, pr_url, title, author, status, detected_from)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(userId, prUrl, title, author, detectedFrom || 'dm');
  return true;
}

function getPending(userId) {
  // pending AND reviewed are both "needs attention"
  return db.prepare(
    "SELECT * FROM pr_tracking WHERE user_id = ? AND status IN ('pending', 'reviewed') ORDER BY created_at DESC"
  ).all(userId);
}

function getAll(userId) {
  return db.prepare('SELECT * FROM pr_tracking WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

function getStale(userId, hours = 24) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  return db.prepare(
    "SELECT * FROM pr_tracking WHERE user_id = ? AND status IN ('pending', 'reviewed') AND created_at < ?"
  ).all(userId, cutoff);
}

function updateStatus(userId, prUrl, status) {
  db.prepare(
    "UPDATE pr_tracking SET status = ?, updated_at = datetime('now') WHERE user_id = ? AND pr_url = ?"
  ).run(status, userId, prUrl);
}

function updateGhState(userId, prUrl, ghState, reviewStatus) {
  db.prepare(
    "UPDATE pr_tracking SET gh_state = ?, gh_review_status = ?, updated_at = datetime('now') WHERE user_id = ? AND pr_url = ?"
  ).run(ghState, reviewStatus, userId, prUrl);
}

function markMergedOrClosed(userId, prUrl, state) {
  db.prepare(
    "UPDATE pr_tracking SET status = ?, gh_state = ?, updated_at = datetime('now') WHERE user_id = ? AND pr_url = ?"
  ).run(state, state, userId, prUrl);
}

module.exports = { upsert, getPending, getAll, getStale, updateStatus, updateGhState, markMergedOrClosed };
