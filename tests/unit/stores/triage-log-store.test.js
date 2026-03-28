// Must be first — sets DONNA_DB_PATH=':memory:' before any require of src/db
const { resetDb, db } = require('../../helpers/db-setup');
const triageLogStore = require('../../../src/stores/triage-log-store');

const USER = 'U001';

function makeEntry(overrides = {}) {
  return {
    channelId: 'C001',
    channelName: 'general',
    classification: 'noise',
    reason: 'test reason',
    messageText: 'hello world',
    messageTs: '1234567890.000100',
    ...overrides,
  };
}

beforeEach(() => {
  resetDb();
});

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------

describe('triageLogStore.add', () => {
  it('inserts a noise entry without error', () => {
    expect(() => triageLogStore.add(USER, makeEntry())).not.toThrow();
  });

  it('inserts an attention entry without error', () => {
    expect(() =>
      triageLogStore.add(USER, makeEntry({ classification: 'attention' }))
    ).not.toThrow();
  });

  it('truncates messageText to 200 characters', () => {
    const longText = 'x'.repeat(300);
    triageLogStore.add(USER, makeEntry({ messageText: longText }));
    const row = db.prepare('SELECT message_text FROM triage_log WHERE user_id = ?').get(USER);
    expect(row.message_text.length).toBe(200);
  });

  it('handles null/undefined messageText gracefully', () => {
    expect(() =>
      triageLogStore.add(USER, makeEntry({ messageText: null }))
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getTodayStats
// ---------------------------------------------------------------------------

describe('triageLogStore.getTodayStats', () => {
  it('returns zero counts when no entries exist', () => {
    const stats = triageLogStore.getTodayStats(USER);
    expect(stats.totalNoise).toBe(0);
    expect(stats.totalAttention).toBe(0);
    expect(stats.noiseByChannel).toEqual({});
    expect(stats.attentionByChannel).toEqual({});
  });

  it('counts noise and attention separately', () => {
    triageLogStore.add(USER, makeEntry({ classification: 'noise', channelName: 'general' }));
    triageLogStore.add(USER, makeEntry({ classification: 'noise', channelName: 'general' }));
    triageLogStore.add(USER, makeEntry({ classification: 'attention', channelName: 'alerts' }));

    const stats = triageLogStore.getTodayStats(USER);
    expect(stats.totalNoise).toBe(2);
    expect(stats.totalAttention).toBe(1);
  });

  it('groups counts by channel name', () => {
    triageLogStore.add(USER, makeEntry({ classification: 'noise', channelName: 'ch1' }));
    triageLogStore.add(USER, makeEntry({ classification: 'noise', channelName: 'ch1' }));
    triageLogStore.add(USER, makeEntry({ classification: 'noise', channelName: 'ch2' }));

    const stats = triageLogStore.getTodayStats(USER);
    expect(stats.noiseByChannel).toEqual({ ch1: 2, ch2: 1 });
  });

  it('is scoped per user', () => {
    triageLogStore.add('U002', makeEntry({ classification: 'attention' }));
    const stats = triageLogStore.getTodayStats(USER);
    expect(stats.totalAttention).toBe(0);
  });

  it('only counts entries from today', () => {
    triageLogStore.add(USER, makeEntry({ classification: 'noise' }));

    // Force the log_date to yesterday
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    db.prepare('UPDATE triage_log SET log_date = ? WHERE user_id = ?').run(yesterday, USER);

    const stats = triageLogStore.getTodayStats(USER);
    expect(stats.totalNoise).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getNewNoiseSinceLastQuery
// ---------------------------------------------------------------------------

describe('triageLogStore.getNewNoiseSinceLastQuery', () => {
  it('returns all noise on first query (no last_queried row)', () => {
    triageLogStore.add(USER, makeEntry({ classification: 'noise', channelName: 'general' }));
    triageLogStore.add(USER, makeEntry({ classification: 'noise', channelName: 'alerts' }));

    const result = triageLogStore.getNewNoiseSinceLastQuery(USER);
    expect(result.total).toBe(2);
    expect(result.byChannel).toEqual({ general: 1, alerts: 1 });
  });

  it('returns zero noise on second call immediately after the first', () => {
    triageLogStore.add(USER, makeEntry({ classification: 'noise' }));
    triageLogStore.getNewNoiseSinceLastQuery(USER); // advances the cursor

    const result = triageLogStore.getNewNoiseSinceLastQuery(USER);
    expect(result.total).toBe(0);
  });

  it('does not count attention entries', () => {
    triageLogStore.add(USER, makeEntry({ classification: 'attention' }));
    const result = triageLogStore.getNewNoiseSinceLastQuery(USER);
    expect(result.total).toBe(0);
  });

  it('picks up new noise added after the cursor was advanced', () => {
    triageLogStore.add(USER, makeEntry({ classification: 'noise', channelName: 'ch1' }));
    triageLogStore.getNewNoiseSinceLastQuery(USER); // advance cursor to "now"

    // Back-date the cursor to 10 seconds ago so new inserts will be after it.
    // The cursor is stored as an ISO string in last_queried.queried_at.
    const pastTs = new Date(Date.now() - 10000).toISOString();
    db.prepare('UPDATE last_queried SET queried_at = ? WHERE user_id = ?').run(pastTs, USER);

    // Insert the new noise entry with an explicit logged_at that is definitely AFTER pastTs.
    // triage_log.logged_at defaults to datetime('now') which SQLite stores as 'YYYY-MM-DD HH:MM:SS'.
    // We insert directly with an ISO string so the comparison against the ISO cursor works.
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO triage_log (user_id, channel_id, channel_name, classification, reason, message_text, message_ts, log_date, logged_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(USER, 'C002', 'ch2', 'noise', 'test', 'msg', '111.000', new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }), nowIso);

    const result = triageLogStore.getNewNoiseSinceLastQuery(USER);
    expect(result.total).toBe(1);
    expect(result.byChannel).toEqual({ ch2: 1 });
  });

  it('is scoped per user', () => {
    triageLogStore.add('U002', makeEntry({ classification: 'noise' }));
    const result = triageLogStore.getNewNoiseSinceLastQuery(USER);
    expect(result.total).toBe(0);
  });
});
