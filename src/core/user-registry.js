const userStore = require('../stores/user-store');

/**
 * Get or create a user. Returns { user, isNew }.
 */
function ensureUser(userId, displayName) {
  const existing = userStore.getById(userId);
  if (existing) return { user: existing, isNew: false };

  const user = userStore.getOrCreate(userId, displayName, 0);
  return { user, isNew: true };
}

/**
 * Check if user has completed onboarding.
 */
function isOnboarded(userId) {
  const user = userStore.getById(userId);
  return user?.onboarding_complete === 1;
}

/**
 * Get user's triage channels.
 */
function getTriageChannels(userId) {
  const db = require('../db');
  return db.prepare('SELECT channel_id, channel_name FROM user_triage_channels WHERE user_id = ?').all(userId);
}

/**
 * Set user's triage channels (replace all).
 */
function setTriageChannels(userId, channels) {
  const db = require('../db');
  const del = db.prepare('DELETE FROM user_triage_channels WHERE user_id = ?');
  const ins = db.prepare('INSERT INTO user_triage_channels (user_id, channel_id, channel_name) VALUES (?, ?, ?)');

  const txn = db.transaction(() => {
    del.run(userId);
    for (const ch of channels) {
      ins.run(userId, ch.id, ch.name);
    }
  });
  txn();
}

module.exports = { ensureUser, isOnboarded, getTriageChannels, setTriageChannels };
