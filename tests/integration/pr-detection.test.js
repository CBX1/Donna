// Must be first — sets DONNA_DB_PATH=':memory:' before any require of src/db
process.env.DONNA_DB_PATH = ':memory:';

const { resetDb } = require('../helpers/db-setup');

// Require these BEFORE tracker so the module cache has them registered,
// then we spy on their exports (vi.spyOn works reliably with CJS modules).
const github = require('../../src/integrations/github');
const notion = require('../../src/integrations/notion');

const tracker = require('../../src/pr-tracker/tracker');
const prStore = require('../../src/stores/pr-store');
const userStore = require('../../src/stores/user-store');

const USER_ID = 'U-PR-001';
const SENDER_NAME = 'alice';
const PR_URL = 'https://github.com/org/repo/pull/42';

function seedUser(overrides = {}) {
  userStore.getOrCreate(USER_ID, SENDER_NAME, 0);
  if (Object.keys(overrides).length > 0) {
    userStore.update(USER_ID, overrides);
  }
}

beforeEach(() => {
  resetDb();
  vi.spyOn(github, 'getPrDetails').mockResolvedValue({
    state: 'open',
    title: 'Fix critical bug',
    author: 'alice',
    merged: false,
    isDraft: false,
    reviewStatus: 'pending',
    requestedReviewers: [],
  });
  vi.spyOn(github, 'getReviewRequests').mockResolvedValue([]);
  vi.spyOn(notion, 'createPrReview').mockResolvedValue({ id: 'notion-page-1' });
  vi.spyOn(notion, 'markPrDoneByUrl').mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PR Detection Pipeline — detectFromDm', () => {
  it('DM with a GitHub PR URL detects and stores the PR in the database', async () => {
    seedUser();

    await tracker.detectFromDm(`Check out this PR: ${PR_URL}`, USER_ID, SENDER_NAME);

    const pending = prStore.getPending(USER_ID);
    expect(pending).toHaveLength(1);
    expect(pending[0].pr_url).toBe(PR_URL);
    expect(pending[0].title).toBe('Fix critical bug');
    expect(pending[0].author).toBe('alice');
    expect(pending[0].detected_from).toBe('dm');
    expect(pending[0].status).toBe('pending');
  });

  it('calls github.getPrDetails with the extracted PR URL', async () => {
    seedUser();

    await tracker.detectFromDm(`Review needed: ${PR_URL}`, USER_ID, SENDER_NAME);

    expect(github.getPrDetails).toHaveBeenCalledOnce();
    expect(github.getPrDetails).toHaveBeenCalledWith(PR_URL);
  });

  it('attempts Notion sync when the user has a notion_database_id configured', async () => {
    seedUser({ notion_database_id: 'db-abc123' });

    await tracker.detectFromDm(PR_URL, USER_ID, SENDER_NAME);

    expect(notion.createPrReview).toHaveBeenCalledOnce();
    expect(notion.createPrReview).toHaveBeenCalledWith('db-abc123', expect.objectContaining({
      prUrl: PR_URL,
    }));
  });

  it('does NOT attempt Notion sync when user has no notion_database_id', async () => {
    seedUser();

    await tracker.detectFromDm(PR_URL, USER_ID, SENDER_NAME);

    expect(notion.createPrReview).not.toHaveBeenCalled();
  });

  it('DM without a PR URL stores nothing in the database', async () => {
    seedUser();

    await tracker.detectFromDm('Hey, how is the sprint going?', USER_ID, SENDER_NAME);

    expect(prStore.getPending(USER_ID)).toHaveLength(0);
    expect(github.getPrDetails).not.toHaveBeenCalled();
  });

  it('plain text DM with no GitHub link stores nothing', async () => {
    seedUser();

    await tracker.detectFromDm('Looks good, approved!', USER_ID, SENDER_NAME);

    expect(prStore.getPending(USER_ID)).toHaveLength(0);
  });

  it('strips trailing path segments from PR URL (e.g. /files)', async () => {
    seedUser();
    const urlWithFiles = `${PR_URL}/files`;

    await tracker.detectFromDm(urlWithFiles, USER_ID, SENDER_NAME);

    const pending = prStore.getPending(USER_ID);
    expect(pending).toHaveLength(1);
    expect(pending[0].pr_url).toBe(PR_URL);
  });

  it('uses senderName as author fallback when getPrDetails returns null', async () => {
    seedUser();
    github.getPrDetails.mockResolvedValue(null);

    await tracker.detectFromDm(PR_URL, USER_ID, SENDER_NAME);

    const pending = prStore.getPending(USER_ID);
    expect(pending).toHaveLength(1);
    expect(pending[0].author).toBe(SENDER_NAME);
  });

  it('does not throw when getPrDetails rejects', async () => {
    seedUser();
    github.getPrDetails.mockRejectedValue(new Error('GitHub API unavailable'));

    // detectFromDm catches internally and should not propagate
    await expect(tracker.detectFromDm(PR_URL, USER_ID, SENDER_NAME)).resolves.toBeNull();
  });

  it('does not duplicate a PR that is already tracked', async () => {
    seedUser();

    await tracker.detectFromDm(PR_URL, USER_ID, SENDER_NAME);
    await tracker.detectFromDm(PR_URL, USER_ID, SENDER_NAME);

    expect(prStore.getPending(USER_ID)).toHaveLength(1);
  });
});

describe('PR Detection Pipeline — refreshPrsForUser', () => {
  const PR_URL_A = 'https://github.com/org/repo/pull/10';
  const PR_URL_B = 'https://github.com/org/repo/pull/20';

  it('stores PRs returned by getReviewRequests', async () => {
    seedUser({ github_username: 'alice' });
    github.getReviewRequests.mockResolvedValue([
      { prUrl: PR_URL_A, title: 'PR A', author: 'bob' },
      { prUrl: PR_URL_B, title: 'PR B', author: 'carol' },
    ]);
    github.getPrDetails.mockResolvedValue({
      state: 'open', title: 'PR', author: 'bob', merged: false, reviewStatus: 'pending',
    });

    await tracker.refreshPrsForUser(USER_ID);

    const pending = prStore.getPending(USER_ID);
    const urls = pending.map(p => p.pr_url);
    expect(urls).toContain(PR_URL_A);
    expect(urls).toContain(PR_URL_B);
  });

  it('marks a previously tracked PR as merged when GitHub says it is merged', async () => {
    seedUser({ github_username: 'alice' });

    // Seed a pending PR manually
    prStore.upsert(USER_ID, { prUrl: PR_URL_A, title: 'PR A', author: 'bob', detectedFrom: 'dm' });

    // GitHub review queue is empty — PR was merged and removed from the queue
    github.getReviewRequests.mockResolvedValue([]);
    github.getPrDetails.mockResolvedValue({
      state: 'merged', title: 'PR A', author: 'bob', merged: true, reviewStatus: 'approved',
    });

    await tracker.refreshPrsForUser(USER_ID);

    const all = prStore.getAll(USER_ID);
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('merged');
  });

  it('cleans up stale PRs that are no longer in the review queue and are closed', async () => {
    seedUser({ github_username: 'alice' });

    prStore.upsert(USER_ID, { prUrl: PR_URL_A, title: 'Old PR', author: 'dan', detectedFrom: 'dm' });
    prStore.upsert(USER_ID, { prUrl: PR_URL_B, title: 'Active PR', author: 'eve', detectedFrom: 'dm' });

    // Only PR_URL_B remains in the review queue
    github.getReviewRequests.mockResolvedValue([
      { prUrl: PR_URL_B, title: 'Active PR', author: 'eve' },
    ]);
    github.getPrDetails.mockImplementation(async (url) => {
      if (url === PR_URL_A) {
        return { state: 'closed', title: 'Old PR', author: 'dan', merged: false };
      }
      return { state: 'open', title: 'Active PR', author: 'eve', merged: false, reviewStatus: 'pending' };
    });

    await tracker.refreshPrsForUser(USER_ID);

    const all = prStore.getAll(USER_ID);
    const closed = all.find(p => p.pr_url === PR_URL_A);
    const active = all.find(p => p.pr_url === PR_URL_B);

    expect(closed.status).toBe('closed');
    expect(active.status).toBe('pending');
  });

  it('does nothing when user does not exist', async () => {
    await expect(tracker.refreshPrsForUser('U-NONEXISTENT')).resolves.toBeUndefined();
    expect(github.getReviewRequests).not.toHaveBeenCalled();
  });

  it('skips GitHub API call when user has no github_username', async () => {
    seedUser(); // no github_username

    await tracker.refreshPrsForUser(USER_ID);

    expect(github.getReviewRequests).not.toHaveBeenCalled();
  });
});
