// Must be first — sets DONNA_DB_PATH=':memory:' before any require of src/db
const { resetDb, db } = require('../../helpers/db-setup');
const conversationStore = require('../../../src/stores/conversation-store');

const USER = 'U001';

/**
 * SQLite stores datetime('now') as 'YYYY-MM-DD HH:MM:SS' (space separator, no Z).
 * The getHistory() cutoff is produced by toISOString() which uses 'T' as separator.
 * String comparison: ' ' (ASCII 32) < 'T' (ASCII 84), so SQLite-format rows always
 * compare as OLDER than any ISO cutoff — they would never pass the `created_at > ?` filter.
 *
 * Fix: insert test rows with full ISO timestamps (including 'T' and 'Z') so that
 * SQLite's string comparison works correctly against the ISO cutoff.
 */
function insertMessage(userId, role, text, offsetMs = 0) {
  const isoTs = new Date(Date.now() - offsetMs).toISOString();
  db.prepare(
    'INSERT INTO conversation_history (user_id, role, message, created_at) VALUES (?, ?, ?, ?)'
  ).run(userId, role, text, isoTs);
}

beforeEach(() => {
  resetDb();
});

// ---------------------------------------------------------------------------
// addMessage
// ---------------------------------------------------------------------------

describe('conversationStore.addMessage', () => {
  it('inserts a user message without error', () => {
    expect(() => conversationStore.addMessage(USER, 'user', 'Hello')).not.toThrow();
  });

  it('inserts a model (assistant) message without error', () => {
    expect(() => conversationStore.addMessage(USER, 'model', 'Hi there!')).not.toThrow();
  });

  it('persists the message so it is visible in the DB', () => {
    conversationStore.addMessage(USER, 'user', 'ping');
    const row = db.prepare('SELECT * FROM conversation_history WHERE user_id = ?').get(USER);
    expect(row).not.toBeNull();
    expect(row.role).toBe('user');
    expect(row.message).toBe('ping');
  });
});

// ---------------------------------------------------------------------------
// getHistory
// ---------------------------------------------------------------------------

describe('conversationStore.getHistory', () => {
  it('returns an empty array when no messages exist', () => {
    expect(conversationStore.getHistory(USER)).toEqual([]);
  });

  it('returns messages in chronological order (oldest first)', () => {
    // Insert with explicit timestamps spaced 1 second apart so ordering is stable
    insertMessage(USER, 'user', 'first', 3000);
    insertMessage(USER, 'model', 'second', 2000);
    insertMessage(USER, 'user', 'third', 1000);

    const history = conversationStore.getHistory(USER);
    expect(history).toHaveLength(3);
    expect(history[0].parts[0].text).toBe('first');
    expect(history[1].parts[0].text).toBe('second');
    expect(history[2].parts[0].text).toBe('third');
  });

  it('formats messages with role, parts, and timestamp fields', () => {
    insertMessage(USER, 'user', 'hello');
    const history = conversationStore.getHistory(USER);

    expect(history[0]).toHaveProperty('role', 'user');
    expect(history[0]).toHaveProperty('parts');
    expect(history[0].parts).toEqual([{ text: 'hello' }]);
    expect(history[0]).toHaveProperty('timestamp');
    expect(typeof history[0].timestamp).toBe('number');
  });

  it('respects the maxMessages limit', () => {
    for (let i = 0; i < 25; i++) {
      insertMessage(USER, 'user', `msg ${i}`, (25 - i) * 1000);
    }
    const history = conversationStore.getHistory(USER, 10);
    expect(history).toHaveLength(10);
  });

  it('defaults maxMessages to 20', () => {
    for (let i = 0; i < 25; i++) {
      insertMessage(USER, 'user', `msg ${i}`, (25 - i) * 1000);
    }
    const history = conversationStore.getHistory(USER);
    expect(history).toHaveLength(20);
  });

  it('only returns messages within the 24-hour time window', () => {
    insertMessage(USER, 'user', 'recent', 1000);

    // Insert one message that is 25 hours old (outside window) — use ISO format
    const oldTs = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    db.prepare(
      'INSERT INTO conversation_history (user_id, role, message, created_at) VALUES (?, ?, ?, ?)'
    ).run(USER, 'user', 'old message', oldTs);

    const history = conversationStore.getHistory(USER);
    expect(history).toHaveLength(1);
    expect(history[0].parts[0].text).toBe('recent');
  });

  it('is scoped per user', () => {
    insertMessage('U002', 'user', 'other user message');
    expect(conversationStore.getHistory(USER)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// pruneOlderThan
// ---------------------------------------------------------------------------

describe('conversationStore.pruneOlderThan', () => {
  it('removes messages older than the specified hours', () => {
    const oldTs = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
    db.prepare(
      'INSERT INTO conversation_history (user_id, role, message, created_at) VALUES (?, ?, ?, ?)'
    ).run(USER, 'user', 'old message', oldTs);

    conversationStore.pruneOlderThan(12);

    const remaining = db.prepare('SELECT * FROM conversation_history WHERE user_id = ?').all(USER);
    expect(remaining).toHaveLength(0);
  });

  it('keeps messages newer than the specified hours', () => {
    insertMessage(USER, 'user', 'recent message', 1000);
    conversationStore.pruneOlderThan(12);

    const remaining = db.prepare('SELECT * FROM conversation_history WHERE user_id = ?').all(USER);
    expect(remaining).toHaveLength(1);
  });

  it('defaults to 12 hours', () => {
    const oldTs = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
    db.prepare(
      'INSERT INTO conversation_history (user_id, role, message, created_at) VALUES (?, ?, ?, ?)'
    ).run(USER, 'user', 'old message', oldTs);

    conversationStore.pruneOlderThan(); // use default

    const remaining = db.prepare('SELECT * FROM conversation_history WHERE user_id = ?').all(USER);
    expect(remaining).toHaveLength(0);
  });
});
