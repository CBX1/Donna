// Must be first — sets DONNA_DB_PATH=':memory:' before any require of src/db
process.env.DONNA_DB_PATH = ':memory:';

const { resetDb } = require('../helpers/db-setup');

// Require gemini BEFORE classifier so the module is in cache; we spy on exports.
// vi.spyOn works reliably with CJS modules — no factory hoisting needed.
const gemini = require('../../src/integrations/gemini');

const classifier = require('../../src/triage/classifier');
const triageLogStore = require('../../src/stores/triage-log-store');
const triageRulesStore = require('../../src/stores/triage-rules-store');
const userStore = require('../../src/stores/user-store');

const USER_ID = 'U-TRIAGE-001';

function seedUser() {
  userStore.getOrCreate(USER_ID, 'test-user', 0);
}

function logMessages(userId, channelId, channelName, classifications) {
  // Helper to manually log pre-classified messages into triage_log
  classifications.forEach(({ text, ts, classification, reason }) => {
    triageLogStore.add(userId, {
      channelId,
      channelName,
      classification,
      reason,
      messageText: text,
      messageTs: ts || `${Date.now() / 1000}`,
    });
  });
}

beforeEach(() => {
  resetDb();
  seedUser();
  vi.spyOn(gemini, 'askJson').mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Triage Classification Pipeline — classifyBatch', () => {
  it('returns empty array for an empty message batch', async () => {
    const results = await classifier.classifyBatch([]);
    expect(results).toEqual([]);
    expect(gemini.askJson).not.toHaveBeenCalled();
  });

  it('classifies a batch of messages using Gemini and returns results in index order', async () => {
    const messages = [
      { text: 'Build succeeded in 2m 30s', user: 'ci-bot' },
      { text: 'Deployment FAILED: timeout in prod', user: 'deploy-bot' },
      { text: 'All health checks passed', user: 'monitor-bot' },
    ];

    gemini.askJson.mockResolvedValue([
      { index: 0, classification: 'noise', reason: 'Routine build success' },
      { index: 1, classification: 'attention', reason: 'Deployment failure in prod' },
      { index: 2, classification: 'noise', reason: 'Health checks normal' },
    ]);

    const results = await classifier.classifyBatch(messages);

    expect(gemini.askJson).toHaveBeenCalledOnce();
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ index: 0, classification: 'noise' });
    expect(results[1]).toMatchObject({ index: 1, classification: 'attention' });
    expect(results[2]).toMatchObject({ index: 2, classification: 'noise' });
  });

  it('passes formatted messages to Gemini in [index] user: text format', async () => {
    gemini.askJson.mockResolvedValue([
      { index: 0, classification: 'noise', reason: 'success' },
    ]);

    await classifier.classifyBatch([{ text: 'Cron job finished', user: 'scheduler' }]);

    const [, userPrompt] = gemini.askJson.mock.calls[0];
    expect(userPrompt).toContain('[0] scheduler: Cron job finished');
  });

  it('defaults to all-attention when Gemini rejects', async () => {
    const messages = [
      { text: 'Deploy done', user: 'bot' },
      { text: 'Health check ok', user: 'bot' },
    ];
    gemini.askJson.mockRejectedValue(new Error('Gemini unavailable'));

    const results = await classifier.classifyBatch(messages);

    expect(results).toHaveLength(2);
    results.forEach(r => {
      expect(r.classification).toBe('attention');
    });
  });
});

describe('Triage Classification Pipeline — triage log storage', () => {
  it('stores noise and attention classifications in triage_log', () => {
    logMessages(USER_ID, 'C001', 'deployments', [
      { text: 'Build passed', ts: '1700000001.000', classification: 'noise', reason: 'Routine success' },
      { text: 'Disk usage at 95%', ts: '1700000002.000', classification: 'attention', reason: 'High disk usage' },
      { text: 'Tests all green', ts: '1700000003.000', classification: 'noise', reason: 'Test suite passed' },
    ]);

    const stats = triageLogStore.getTodayStats(USER_ID);
    expect(stats.totalNoise).toBe(2);
    expect(stats.totalAttention).toBe(1);
    expect(stats.noiseByChannel['deployments']).toBe(2);
    expect(stats.attentionByChannel['deployments']).toBe(1);
  });

  it('correctly counts stats for multiple channels independently', () => {
    logMessages(USER_ID, 'C001', 'builds', [
      { text: 'Build ok', ts: '1700000001.000', classification: 'noise', reason: 'ok' },
      { text: 'Build failed', ts: '1700000002.000', classification: 'attention', reason: 'failed' },
    ]);
    logMessages(USER_ID, 'C002', 'alerts', [
      { text: 'Alert: memory spike', ts: '1700000003.000', classification: 'attention', reason: 'spike' },
    ]);

    const stats = triageLogStore.getTodayStats(USER_ID);
    expect(stats.totalNoise).toBe(1);
    expect(stats.totalAttention).toBe(2);
    expect(stats.noiseByChannel['builds']).toBe(1);
    expect(stats.attentionByChannel['builds']).toBe(1);
    expect(stats.attentionByChannel['alerts']).toBe(1);
  });

  it('does not mix triage logs between different users', () => {
    const OTHER_USER = 'U-TRIAGE-002';
    userStore.getOrCreate(OTHER_USER, 'other-user', 0);

    logMessages(USER_ID, 'C001', 'general', [
      { text: 'User 1 message', ts: '1700000001.000', classification: 'attention', reason: 'test' },
    ]);
    logMessages(OTHER_USER, 'C001', 'general', [
      { text: 'User 2 message', ts: '1700000002.000', classification: 'noise', reason: 'test' },
    ]);

    const statsUser1 = triageLogStore.getTodayStats(USER_ID);
    const statsUser2 = triageLogStore.getTodayStats(OTHER_USER);

    expect(statsUser1.totalAttention).toBe(1);
    expect(statsUser1.totalNoise).toBe(0);
    expect(statsUser2.totalAttention).toBe(0);
    expect(statsUser2.totalNoise).toBe(1);
  });
});

describe('Triage Pipeline — auto-read channel rule', () => {
  it('marks all messages in an auto-read channel as noise without calling Gemini', () => {
    triageRulesStore.addAutoReadChannel(USER_ID, 'deploy-notifications');

    expect(triageRulesStore.isAutoReadChannel(USER_ID, 'deploy-notifications')).toBe(true);

    // Simulate what the scheduler does: log every message as noise for auto-read channels
    const messages = [
      { text: 'Deployed v1.2.3 to prod', ts: '1700000001.000' },
      { text: 'Deployed v1.2.4 to staging', ts: '1700000002.000' },
    ];

    for (const msg of messages) {
      triageLogStore.add(USER_ID, {
        channelId: 'C100',
        channelName: 'deploy-notifications',
        classification: 'noise',
        reason: 'Auto-read channel',
        messageText: msg.text,
        messageTs: msg.ts,
      });
    }

    expect(gemini.askJson).not.toHaveBeenCalled();

    const stats = triageLogStore.getTodayStats(USER_ID);
    expect(stats.totalNoise).toBe(2);
    expect(stats.totalAttention).toBe(0);
  });

  it('auto-read channel rule is user-specific and does not affect other users', () => {
    const OTHER_USER = 'U-TRIAGE-003';
    userStore.getOrCreate(OTHER_USER, 'other', 0);

    triageRulesStore.addAutoReadChannel(USER_ID, 'monitoring');

    expect(triageRulesStore.isAutoReadChannel(USER_ID, 'monitoring')).toBe(true);
    expect(triageRulesStore.isAutoReadChannel(OTHER_USER, 'monitoring')).toBe(false);
  });
});

describe('Triage Pipeline — ignore pattern rule', () => {
  it('messages matching an ignore pattern are classified as noise', () => {
    triageRulesStore.addIgnorePattern(USER_ID, 'health check passed');

    const messages = [
      'health check passed in 200ms',
      'HEALTH CHECK PASSED',
      'All health check passed OK',
    ];

    messages.forEach((text, i) => {
      const matches = triageRulesStore.matchesIgnorePattern(USER_ID, text);
      expect(matches).toBe(true);

      // Log as noise — mirrors what the scheduler does when pattern matches
      triageLogStore.add(USER_ID, {
        channelId: 'C200',
        channelName: 'infra',
        classification: 'noise',
        reason: 'Matched ignore pattern',
        messageText: text,
        messageTs: `17000000${i}.000`,
      });
    });

    expect(gemini.askJson).not.toHaveBeenCalled();
    const stats = triageLogStore.getTodayStats(USER_ID);
    expect(stats.totalNoise).toBe(3);
  });

  it('messages NOT matching an ignore pattern return false', () => {
    triageRulesStore.addIgnorePattern(USER_ID, 'health check passed');

    expect(triageRulesStore.matchesIgnorePattern(USER_ID, 'health check FAILED')).toBe(false);
    expect(triageRulesStore.matchesIgnorePattern(USER_ID, 'deploy failed on prod')).toBe(false);
  });

  it('ignore pattern matching is case-insensitive', () => {
    triageRulesStore.addIgnorePattern(USER_ID, 'DEPLOYMENT SUCCEEDED');

    expect(triageRulesStore.matchesIgnorePattern(USER_ID, 'deployment succeeded in 45s')).toBe(true);
    expect(triageRulesStore.matchesIgnorePattern(USER_ID, 'Deployment Succeeded!')).toBe(true);
  });

  it('multiple ignore patterns work independently', () => {
    triageRulesStore.addIgnorePattern(USER_ID, 'cron job completed');
    triageRulesStore.addIgnorePattern(USER_ID, 'test suite passed');

    expect(triageRulesStore.matchesIgnorePattern(USER_ID, 'cron job completed with 0 errors')).toBe(true);
    expect(triageRulesStore.matchesIgnorePattern(USER_ID, 'test suite passed in 120s')).toBe(true);
    expect(triageRulesStore.matchesIgnorePattern(USER_ID, 'deploy failed')).toBe(false);
  });
});

describe('Triage Pipeline — end-to-end batch classification + log storage', () => {
  it('batch classified results are correctly stored in triage_log', async () => {
    const messages = [
      { text: 'All tests passed', user: 'ci-bot' },
      { text: 'ERROR: Out of memory on worker-3', user: 'monitor-bot' },
    ];

    gemini.askJson.mockResolvedValue([
      { index: 0, classification: 'noise', reason: 'Test suite passed' },
      { index: 1, classification: 'attention', reason: 'Memory error on worker' },
    ]);

    const results = await classifier.classifyBatch(messages);

    // Log the results — simulating what the scheduler does after classification
    results.forEach((r, i) => {
      triageLogStore.add(USER_ID, {
        channelId: 'C300',
        channelName: 'eng-alerts',
        classification: r.classification,
        reason: r.reason,
        messageText: messages[r.index]?.text || '',
        messageTs: `1700000${i}.000`,
      });
    });

    const stats = triageLogStore.getTodayStats(USER_ID);
    expect(stats.totalNoise).toBe(1);
    expect(stats.totalAttention).toBe(1);
    expect(stats.noiseByChannel['eng-alerts']).toBe(1);
    expect(stats.attentionByChannel['eng-alerts']).toBe(1);
  });
});
