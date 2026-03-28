const db = require('../db');
const { todayIST } = require('../utils/time');

const getLastQueriedStmt = db.prepare('SELECT queried_at FROM last_queried WHERE user_id = ?');
const upsertLastQueriedStmt = db.prepare(
  'INSERT INTO last_queried (user_id, queried_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET queried_at = ?'
);

function add(userId, { channelId, channelName, classification, reason, messageText, messageTs }) {
  const logDate = todayIST();
  db.prepare(`
    INSERT INTO triage_log (user_id, channel_id, channel_name, classification, reason, message_text, message_ts, log_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, channelId, channelName, classification, reason, (messageText || '').substring(0, 200), messageTs, logDate);
}

/**
 * Get triage stats since last query.
 * - Noise: only shows NEW noise since last query (then advances timestamp)
 * - Attention: shows ALL unresolved attention items from today (doesn't get cleared by asking)
 */
function getStatsSinceLastQuery(userId) {
  const row = getLastQueriedStmt.get(userId);
  const since = row ? row.queried_at : '1970-01-01T00:00:00Z';

  // Noise: only new since last query
  const noiseEntries = db.prepare(
    "SELECT * FROM triage_log WHERE user_id = ? AND classification = 'noise' AND logged_at > ? ORDER BY logged_at"
  ).all(userId, since);

  // Update last queried (only affects noise visibility next time)
  const now = new Date().toISOString();
  upsertLastQueriedStmt.run(userId, now, now);

  // Attention: ALL from today that haven't been dismissed
  const today = todayIST();
  const attentionEntries = db.prepare(
    "SELECT * FROM triage_log WHERE user_id = ? AND classification = 'attention' AND log_date = ? ORDER BY logged_at"
  ).all(userId, today);

  const noiseByChannel = {};
  noiseEntries.forEach(e => {
    if (!noiseByChannel[e.channel_name]) noiseByChannel[e.channel_name] = 0;
    noiseByChannel[e.channel_name]++;
  });

  const attentionByChannel = {};
  attentionEntries.forEach(e => {
    if (!attentionByChannel[e.channel_name]) attentionByChannel[e.channel_name] = 0;
    attentionByChannel[e.channel_name]++;
  });

  return {
    totalNoise: noiseEntries.length,
    totalAttention: attentionEntries.length,
    noiseByChannel,
    attentionByChannel,
  };
}

/**
 * Get only NEW noise since last query. Advances the noise timestamp.
 * Does NOT touch attention at all.
 */
function getNewNoiseSinceLastQuery(userId) {
  const row = getLastQueriedStmt.get(userId);
  const since = row ? row.queried_at : '1970-01-01T00:00:00Z';

  const noiseEntries = db.prepare(
    "SELECT * FROM triage_log WHERE user_id = ? AND classification = 'noise' AND logged_at > ? ORDER BY logged_at"
  ).all(userId, since);

  // Advance timestamp (only affects noise next time)
  const now = new Date().toISOString();
  upsertLastQueriedStmt.run(userId, now, now);

  const byChannel = {};
  noiseEntries.forEach(e => {
    if (!byChannel[e.channel_name]) byChannel[e.channel_name] = 0;
    byChannel[e.channel_name]++;
  });

  return { total: noiseEntries.length, byChannel };
}

function getTodayStats(userId) {
  const today = todayIST();
  const entries = db.prepare(
    'SELECT * FROM triage_log WHERE user_id = ? AND log_date = ? ORDER BY logged_at'
  ).all(userId, today);

  const noise = entries.filter(e => e.classification === 'noise');
  const attention = entries.filter(e => e.classification === 'attention');

  const noiseByChannel = {};
  noise.forEach(e => {
    if (!noiseByChannel[e.channel_name]) noiseByChannel[e.channel_name] = 0;
    noiseByChannel[e.channel_name]++;
  });

  const attentionByChannel = {};
  attention.forEach(e => {
    if (!attentionByChannel[e.channel_name]) attentionByChannel[e.channel_name] = 0;
    attentionByChannel[e.channel_name]++;
  });

  return { totalNoise: noise.length, totalAttention: attention.length, noiseByChannel, attentionByChannel };
}

function pruneOlderThan(days = 7) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM triage_log WHERE logged_at < ?').run(cutoff);
}

module.exports = { add, getStatsSinceLastQuery, getNewNoiseSinceLastQuery, getTodayStats, pruneOlderThan };
