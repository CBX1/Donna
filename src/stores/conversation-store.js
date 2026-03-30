const db = require('../db');

function addMessage(userId, role, text) {
  db.prepare(
    'INSERT INTO conversation_history (user_id, role, message) VALUES (?, ?, ?)'
  ).run(userId, role, text);
}

function getHistory(userId, maxMessages = 20) {
  // Get last N messages from the last 12 hours
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT role, message, created_at FROM conversation_history
    WHERE user_id = ? AND created_at > ?
    ORDER BY created_at DESC LIMIT ?
  `).all(userId, cutoff, maxMessages);

  return rows.reverse().map(r => ({
    role: r.role,
    parts: [{ text: r.message }],
    timestamp: new Date(r.created_at).getTime(),
  }));
}

function pruneOlderThan(hours = 12) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM conversation_history WHERE created_at < ?').run(cutoff);
}

module.exports = { addMessage, getHistory, pruneOlderThan };
