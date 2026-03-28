// Must be first — sets DONNA_DB_PATH=':memory:' before any require of src/db
const { resetDb, db } = require('../../helpers/db-setup');
const triageRulesStore = require('../../../src/stores/triage-rules-store');

const USER = 'U001';

/**
 * triage_rules has a FK to users(id). We must insert a user row before
 * any triage_rules operation or SQLite will raise a FK constraint error.
 */
function ensureUser(userId) {
  db.prepare(
    "INSERT OR IGNORE INTO users (id, display_name) VALUES (?, ?)"
  ).run(userId, `User ${userId}`);
}

beforeEach(() => {
  resetDb();
  ensureUser(USER);
});

// ---------------------------------------------------------------------------
// Auto-read channels
// ---------------------------------------------------------------------------

describe('triageRulesStore.addAutoReadChannel', () => {
  it('adds a channel and returns true', () => {
    const result = triageRulesStore.addAutoReadChannel(USER, 'general');
    expect(result).toBe(true);
  });

  it('strips the leading # from channel names', () => {
    triageRulesStore.addAutoReadChannel(USER, '#general');
    expect(triageRulesStore.isAutoReadChannel(USER, 'general')).toBe(true);
  });

  it('returns false when adding a duplicate', () => {
    triageRulesStore.addAutoReadChannel(USER, 'general');
    expect(triageRulesStore.addAutoReadChannel(USER, 'general')).toBe(false);
  });

  it('is case-insensitive for channel names', () => {
    triageRulesStore.addAutoReadChannel(USER, 'General');
    expect(triageRulesStore.isAutoReadChannel(USER, 'general')).toBe(true);
  });
});

describe('triageRulesStore.removeAutoReadChannel', () => {
  it('removes an existing channel and returns true', () => {
    triageRulesStore.addAutoReadChannel(USER, 'general');
    expect(triageRulesStore.removeAutoReadChannel(USER, 'general')).toBe(true);
    expect(triageRulesStore.isAutoReadChannel(USER, 'general')).toBe(false);
  });

  it('returns false when removing a non-existent channel', () => {
    expect(triageRulesStore.removeAutoReadChannel(USER, 'nonexistent')).toBe(false);
  });

  it('strips the leading # when removing', () => {
    triageRulesStore.addAutoReadChannel(USER, 'general');
    expect(triageRulesStore.removeAutoReadChannel(USER, '#general')).toBe(true);
  });
});

describe('triageRulesStore.isAutoReadChannel', () => {
  it('returns false when channel has not been added', () => {
    expect(triageRulesStore.isAutoReadChannel(USER, 'random')).toBe(false);
  });

  it('returns true for a channel that was added', () => {
    triageRulesStore.addAutoReadChannel(USER, 'random');
    expect(triageRulesStore.isAutoReadChannel(USER, 'random')).toBe(true);
  });

  it('is scoped per user', () => {
    ensureUser('U002');
    triageRulesStore.addAutoReadChannel('U002', 'random');
    expect(triageRulesStore.isAutoReadChannel(USER, 'random')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Ignore patterns
// ---------------------------------------------------------------------------

describe('triageRulesStore.addIgnorePattern', () => {
  it('adds a pattern and returns true', () => {
    expect(triageRulesStore.addIgnorePattern(USER, 'standup')).toBe(true);
  });

  it('returns false on duplicate pattern', () => {
    triageRulesStore.addIgnorePattern(USER, 'standup');
    expect(triageRulesStore.addIgnorePattern(USER, 'standup')).toBe(false);
  });
});

describe('triageRulesStore.matchesIgnorePattern', () => {
  it('returns false when no patterns exist', () => {
    expect(triageRulesStore.matchesIgnorePattern(USER, 'daily standup at 9am')).toBe(false);
  });

  it('matches text containing the pattern (case-insensitive)', () => {
    triageRulesStore.addIgnorePattern(USER, 'standup');
    expect(triageRulesStore.matchesIgnorePattern(USER, 'daily STANDUP at 9am')).toBe(true);
  });

  it('returns false when no pattern matches', () => {
    triageRulesStore.addIgnorePattern(USER, 'standup');
    expect(triageRulesStore.matchesIgnorePattern(USER, 'urgent production issue')).toBe(false);
  });

  it('matches any of multiple patterns', () => {
    triageRulesStore.addIgnorePattern(USER, 'standup');
    triageRulesStore.addIgnorePattern(USER, 'lunch');
    expect(triageRulesStore.matchesIgnorePattern(USER, 'team lunch at noon')).toBe(true);
  });

  it('is scoped per user', () => {
    ensureUser('U002');
    triageRulesStore.addIgnorePattern('U002', 'standup');
    expect(triageRulesStore.matchesIgnorePattern(USER, 'standup')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Channel rules
// ---------------------------------------------------------------------------

describe('triageRulesStore.addChannelRule / applyChannelRule', () => {
  it('applies an alert pattern and returns attention classification', () => {
    triageRulesStore.addChannelRule(USER, 'alerts', { alertWhen: 'production down' });
    const result = triageRulesStore.applyChannelRule(USER, 'alerts', 'PRODUCTION DOWN: service unreachable');
    expect(result).not.toBeNull();
    expect(result.classification).toBe('attention');
    expect(result.reason).toContain('production down');
  });

  it('applies a read pattern and returns noise classification', () => {
    triageRulesStore.addChannelRule(USER, 'general', { readWhen: 'standup' });
    const result = triageRulesStore.applyChannelRule(USER, 'general', 'daily standup notes');
    expect(result).not.toBeNull();
    expect(result.classification).toBe('noise');
    expect(result.reason).toContain('standup');
  });

  it('alert pattern takes priority over read pattern', () => {
    triageRulesStore.addChannelRule(USER, 'general', { alertWhen: 'urgent', readWhen: 'standup' });
    // Message matches both patterns
    const result = triageRulesStore.applyChannelRule(USER, 'general', 'urgent standup cancellation');
    expect(result.classification).toBe('attention');
  });

  it('falls back to channel default when no pattern matches', () => {
    triageRulesStore.addChannelRule(USER, 'general', { defaultAction: 'noise' });
    const result = triageRulesStore.applyChannelRule(USER, 'general', 'some random message');
    expect(result).not.toBeNull();
    expect(result.classification).toBe('noise');
    expect(result.reason).toContain('Channel default');
  });

  it('returns null when no rules match at all', () => {
    const result = triageRulesStore.applyChannelRule(USER, 'general', 'some message');
    expect(result).toBeNull();
  });

  it('updates existing channel default action on second call', () => {
    triageRulesStore.addChannelRule(USER, 'general', { defaultAction: 'noise' });
    triageRulesStore.addChannelRule(USER, 'general', { defaultAction: 'attention' });
    const result = triageRulesStore.applyChannelRule(USER, 'general', 'some message');
    expect(result.classification).toBe('attention');
  });

  it('strips # from channel name', () => {
    triageRulesStore.addChannelRule(USER, '#alerts', { defaultAction: 'attention' });
    const result = triageRulesStore.applyChannelRule(USER, 'alerts', 'msg');
    expect(result.classification).toBe('attention');
  });

  it('is scoped per user', () => {
    ensureUser('U002');
    triageRulesStore.addChannelRule('U002', 'alerts', { defaultAction: 'noise' });
    const result = triageRulesStore.applyChannelRule(USER, 'alerts', 'msg');
    expect(result).toBeNull();
  });

  it('does not add duplicate alert patterns', () => {
    triageRulesStore.addChannelRule(USER, 'alerts', { alertWhen: 'fire' });
    triageRulesStore.addChannelRule(USER, 'alerts', { alertWhen: 'fire' });
    const count = db.prepare(
      "SELECT COUNT(*) as c FROM triage_rules WHERE user_id = ? AND rule_type = 'channel_alert' AND pattern = 'fire'"
    ).get(USER);
    expect(count.c).toBe(1);
  });
});
