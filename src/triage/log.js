/**
 * In-memory triage log for daily summary.
 * Tracks a "last queried" timestamp per user (persisted to SQLite).
 */

const db = require('../db');

const log = [];

// Prepared statements for lastQueried
const getLastQueriedStmt = db.prepare('SELECT queried_at FROM last_queried WHERE user_id = ?');
const upsertLastQueriedStmt = db.prepare(
  'INSERT INTO last_queried (user_id, queried_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET queried_at = ?'
);

function getLastQueried(userId) {
  const row = getLastQueriedStmt.get(userId);
  return row ? new Date(row.queried_at) : new Date(0);
}

function setLastQueried(userId) {
  const now = new Date().toISOString();
  upsertLastQueriedStmt.run(userId, now, now);
}

function add({ channel, channelName, classification, reason, messageText, timestamp }) {
  log.push({
    channel,
    channelName,
    classification,
    reason,
    messageText: messageText?.substring(0, 100),
    timestamp: timestamp || new Date(),
    addedAt: new Date(),
    date: new Date().toISOString().split('T')[0],
  });
}

/**
 * Get stats since the user last asked. Shows everything (noise + attention).
 * After calling this, updates the "last queried" marker for the user.
 */
function getStatsSinceLastQuery(userId) {
  const since = getLastQueried(userId);
  const entries = log.filter(e => e.addedAt > since);

  // Update last queried
  setLastQueried(userId);

  if (entries.length === 0) {
    return { totalNoise: 0, totalAttention: 0, noiseByChannel: {}, attentionItems: [], noiseItems: [] };
  }

  const noise = entries.filter(e => e.classification === 'noise');
  const attention = entries.filter(e => e.classification === 'attention');

  // Group noise by channel with sample messages
  const noiseByChannel = {};
  noise.forEach(e => {
    if (!noiseByChannel[e.channelName]) {
      noiseByChannel[e.channelName] = { count: 0, samples: [] };
    }
    noiseByChannel[e.channelName].count++;
    if (noiseByChannel[e.channelName].samples.length < 2) {
      noiseByChannel[e.channelName].samples.push(e.messageText);
    }
  });

  const attentionItems = attention.map(e => ({
    channel: e.channelName,
    reason: e.reason,
    text: e.messageText,
  }));

  return {
    totalNoise: noise.length,
    totalAttention: attention.length,
    noiseByChannel,
    attentionItems,
  };
}

/**
 * Get full day stats (for daily summary).
 */
function getTodayStats() {
  const today = new Date().toISOString().split('T')[0];
  const todayEntries = log.filter(e => e.date === today);

  const noise = todayEntries.filter(e => e.classification === 'noise');
  const attention = todayEntries.filter(e => e.classification === 'attention');

  const noiseByChannel = {};
  noise.forEach(e => {
    if (!noiseByChannel[e.channelName]) noiseByChannel[e.channelName] = 0;
    noiseByChannel[e.channelName]++;
  });

  const attentionItems = attention.map(e => ({
    channel: e.channelName,
    reason: e.reason,
    text: e.messageText,
  }));

  return {
    totalNoise: noise.length,
    totalAttention: attention.length,
    noiseByChannel,
    attentionItems,
  };
}

function clear() {
  log.length = 0;
}

module.exports = { add, getStatsSinceLastQuery, getTodayStats, clear };
