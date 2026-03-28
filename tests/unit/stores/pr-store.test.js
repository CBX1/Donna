// Must be first — sets DONNA_DB_PATH=':memory:' before any require of src/db
const { resetDb } = require('../../helpers/db-setup');
const prStore = require('../../../src/stores/pr-store');

const USER = 'U001';
const PR_URL = 'https://github.com/org/repo/pull/42';
const PR_DATA = { prUrl: PR_URL, title: 'Fix bug', author: 'alice', detectedFrom: 'channel' };

beforeEach(() => {
  resetDb();
});

describe('prStore.upsert', () => {
  it('inserts a new PR and returns true', () => {
    const result = prStore.upsert(USER, PR_DATA);
    expect(result).toBe(true);
  });

  it('returns false when upserting an already-tracked (pending) PR', () => {
    prStore.upsert(USER, PR_DATA);
    const result = prStore.upsert(USER, { ...PR_DATA, title: 'Updated title' });
    expect(result).toBe(false);
  });

  it('updates title and author when PR already exists in pending/reviewed state', () => {
    prStore.upsert(USER, PR_DATA);
    prStore.upsert(USER, { ...PR_DATA, title: 'New title', author: 'bob' });
    const rows = prStore.getAll(USER);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('New title');
    expect(rows[0].author).toBe('bob');
  });

  it('re-opens a PR that was previously in a terminal state and returns true', () => {
    prStore.upsert(USER, PR_DATA);
    prStore.markMergedOrClosed(USER, PR_URL, 'merged');

    const result = prStore.upsert(USER, { ...PR_DATA, title: 'Reopened' });
    expect(result).toBe(true);

    const rows = prStore.getAll(USER);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].title).toBe('Reopened');
  });

  it('defaults detectedFrom to "dm" when not provided', () => {
    prStore.upsert(USER, { prUrl: PR_URL, title: 'T', author: 'a' });
    const rows = prStore.getAll(USER);
    expect(rows[0].detected_from).toBe('dm');
  });
});

describe('prStore.getPending', () => {
  it('returns empty array when no PRs exist', () => {
    expect(prStore.getPending(USER)).toEqual([]);
  });

  it('returns pending PRs for the user', () => {
    prStore.upsert(USER, PR_DATA);
    const pending = prStore.getPending(USER);
    expect(pending).toHaveLength(1);
    expect(pending[0].pr_url).toBe(PR_URL);
    expect(pending[0].status).toBe('pending');
  });

  it('includes PRs with status "reviewed"', () => {
    prStore.upsert(USER, PR_DATA);
    prStore.updateStatus(USER, PR_URL, 'reviewed');
    const pending = prStore.getPending(USER);
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe('reviewed');
  });

  it('excludes terminal state PRs', () => {
    prStore.upsert(USER, PR_DATA);
    prStore.markMergedOrClosed(USER, PR_URL, 'merged');
    expect(prStore.getPending(USER)).toHaveLength(0);
  });

  it('does not return PRs belonging to another user', () => {
    prStore.upsert(USER, PR_DATA);
    expect(prStore.getPending('U999')).toHaveLength(0);
  });
});

describe('prStore.getAll', () => {
  it('returns all PRs for the user regardless of status', () => {
    const pr2 = 'https://github.com/org/repo/pull/43';
    prStore.upsert(USER, PR_DATA);
    prStore.upsert(USER, { prUrl: pr2, title: 'PR 2', author: 'bob', detectedFrom: 'channel' });
    prStore.markMergedOrClosed(USER, pr2, 'closed');

    const all = prStore.getAll(USER);
    expect(all).toHaveLength(2);
  });

  it('orders results by created_at descending', () => {
    const pr2 = 'https://github.com/org/repo/pull/43';
    prStore.upsert(USER, PR_DATA);
    prStore.upsert(USER, { prUrl: pr2, title: 'PR 2', author: 'bob' });

    // Force created_at so pr2 is clearly newer than PR_DATA
    const { db } = require('../../helpers/db-setup');
    const olderTs = new Date(Date.now() - 5000).toISOString().replace('T', ' ').slice(0, 19);
    db.prepare("UPDATE pr_tracking SET created_at = ? WHERE pr_url = ?").run(olderTs, PR_URL);

    const all = prStore.getAll(USER);
    // Most recent insert should come first
    expect(all[0].pr_url).toBe(pr2);
  });
});

describe('prStore.updateGhState', () => {
  it('updates gh_state and gh_review_status', () => {
    prStore.upsert(USER, PR_DATA);
    prStore.updateGhState(USER, PR_URL, 'open', 'approved');

    const rows = prStore.getAll(USER);
    expect(rows[0].gh_state).toBe('open');
    expect(rows[0].gh_review_status).toBe('approved');
  });

  it('is a no-op for a non-existent PR', () => {
    prStore.updateGhState(USER, 'https://github.com/nonexistent', 'open', 'pending');
    expect(prStore.getAll(USER)).toHaveLength(0);
  });
});

describe('prStore.markMergedOrClosed', () => {
  it('sets status and gh_state to the given terminal state', () => {
    prStore.upsert(USER, PR_DATA);
    prStore.markMergedOrClosed(USER, PR_URL, 'closed');

    const rows = prStore.getAll(USER);
    expect(rows[0].status).toBe('closed');
    expect(rows[0].gh_state).toBe('closed');
  });

  it('works with "merged" state', () => {
    prStore.upsert(USER, PR_DATA);
    prStore.markMergedOrClosed(USER, PR_URL, 'merged');

    const rows = prStore.getAll(USER);
    expect(rows[0].status).toBe('merged');
  });
});

describe('prStore.getStale', () => {
  it('returns empty array when no PRs exist', () => {
    expect(prStore.getStale(USER, 24)).toEqual([]);
  });

  it('returns PRs older than the given hours', () => {
    prStore.upsert(USER, PR_DATA);

    // Back-date the created_at so the PR appears stale
    const { db } = require('../../helpers/db-setup');
    const oldTs = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    db.prepare("UPDATE pr_tracking SET created_at = ? WHERE user_id = ? AND pr_url = ?")
      .run(oldTs, USER, PR_URL);

    const stale = prStore.getStale(USER, 24);
    expect(stale).toHaveLength(1);
    expect(stale[0].pr_url).toBe(PR_URL);
  });

  it('does not return PRs newer than the cutoff', () => {
    prStore.upsert(USER, PR_DATA);
    const stale = prStore.getStale(USER, 24);
    expect(stale).toHaveLength(0);
  });

  it('does not return terminal state PRs', () => {
    prStore.upsert(USER, PR_DATA);
    prStore.markMergedOrClosed(USER, PR_URL, 'merged');

    const { db } = require('../../helpers/db-setup');
    const oldTs = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    db.prepare("UPDATE pr_tracking SET created_at = ? WHERE user_id = ? AND pr_url = ?")
      .run(oldTs, USER, PR_URL);

    expect(prStore.getStale(USER, 24)).toHaveLength(0);
  });
});
