const db = require('../db');

function add(userId, channelId, channelName, patterns) {
  db.prepare(`
    INSERT INTO mention_watch (user_id, channel_id, channel_name, patterns)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, channel_id) DO UPDATE SET patterns = ?, channel_name = ?
  `).run(userId, channelId, channelName, JSON.stringify(patterns), JSON.stringify(patterns), channelName);
}

function remove(userId, channelId) {
  const result = db.prepare('DELETE FROM mention_watch WHERE user_id = ? AND channel_id = ?').run(userId, channelId);
  return result.changes > 0;
}

function getForUser(userId) {
  return db.prepare('SELECT * FROM mention_watch WHERE user_id = ?').all(userId).map(r => ({
    ...r, patterns: JSON.parse(r.patterns),
  }));
}

function getForChannel(channelId) {
  return db.prepare('SELECT * FROM mention_watch WHERE channel_id = ?').all(channelId).map(r => ({
    ...r, patterns: JSON.parse(r.patterns),
  }));
}

function getAllWatchedChannelIds() {
  return db.prepare('SELECT DISTINCT channel_id FROM mention_watch').all().map(r => r.channel_id);
}

module.exports = { add, remove, getForUser, getForChannel, getAllWatchedChannelIds };
