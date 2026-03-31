// Must be first — sets DONNA_DB_PATH=':memory:' before any require of src/db
process.env.DONNA_DB_PATH = ':memory:';

const { resetDb } = require('../helpers/db-setup');

// Require these BEFORE tracker so the module cache has them registered,
// then we spy on their exports (vi.spyOn works reliably with CJS modules).
const github = require('../../src/integrations/github');
const notion = require('../../src/integrations/notion');

const tracker = require('../../src/pr-tracker/tracker');
const userStore = require('../../src/stores/user-store');

const USER_ID = 'U-PR-001';
const SENDER_NAME = 'alice';
const PR_URL = 'https://github.com/org/repo/pull/42';
const DB_ID = 'db-abc123';

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
  vi.spyOn(notion, 'createPrReview').mockResolvedValue({ id: 'notion-page-1', url: PR_URL });
  vi.spyOn(notion, 'markPrDoneByUrl').mockResolvedValue(null);
  vi.spyOn(notion, 'queryPrReviews').mockResolvedValue([]);
  vi.spyOn(notion, 'updatePrReview').mockResolvedValue({ id: 'notion-page-1' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PR Detection Pipeline — detectFromDm', () => {
  it('DM with a GitHub PR URL calls createPrReview in Notion', async () => {
    seedUser({ notion_database_id: DB_ID });

    await tracker.detectFromDm(`Check out this PR: ${PR_URL}`, USER_ID, SENDER_NAME);

    expect(notion.createPrReview).toHaveBeenCalledOnce();
    expect(notion.createPrReview).toHaveBeenCalledWith(DB_ID, expect.objectContaining({
      prUrl: PR_URL,
      context: 'Fix critical bug',
      assignee: 'alice',
    }));
  });

  it('calls github.getPrDetails with the extracted PR URL', async () => {
    seedUser({ notion_database_id: DB_ID });

    await tracker.detectFromDm(`Review needed: ${PR_URL}`, USER_ID, SENDER_NAME);

    expect(github.getPrDetails).toHaveBeenCalledOnce();
    expect(github.getPrDetails).toHaveBeenCalledWith(PR_URL);
  });

  it('attempts Notion sync when the user has a notion_database_id configured', async () => {
    seedUser({ notion_database_id: DB_ID });

    await tracker.detectFromDm(PR_URL, USER_ID, SENDER_NAME);

    expect(notion.createPrReview).toHaveBeenCalledOnce();
    expect(notion.createPrReview).toHaveBeenCalledWith(DB_ID, expect.objectContaining({
      prUrl: PR_URL,
    }));
  });

  it('does NOT attempt Notion sync when user has no notion_database_id', async () => {
    seedUser(); // no notion_database_id

    await tracker.detectFromDm(PR_URL, USER_ID, SENDER_NAME);

    expect(notion.createPrReview).not.toHaveBeenCalled();
  });

  it('DM without a PR URL does nothing', async () => {
    seedUser({ notion_database_id: DB_ID });

    await tracker.detectFromDm('Hey, how is the sprint going?', USER_ID, SENDER_NAME);

    expect(notion.createPrReview).not.toHaveBeenCalled();
    expect(github.getPrDetails).not.toHaveBeenCalled();
  });

  it('plain text DM with no GitHub link does nothing', async () => {
    seedUser({ notion_database_id: DB_ID });

    await tracker.detectFromDm('Looks good, approved!', USER_ID, SENDER_NAME);

    expect(notion.createPrReview).not.toHaveBeenCalled();
  });

  it('strips trailing path segments from PR URL (e.g. /files)', async () => {
    seedUser({ notion_database_id: DB_ID });
    const urlWithFiles = `${PR_URL}/files`;

    await tracker.detectFromDm(urlWithFiles, USER_ID, SENDER_NAME);

    expect(notion.createPrReview).toHaveBeenCalledOnce();
    expect(notion.createPrReview).toHaveBeenCalledWith(DB_ID, expect.objectContaining({
      prUrl: PR_URL,
    }));
  });

  it('uses senderName as author fallback when getPrDetails returns null', async () => {
    seedUser({ notion_database_id: DB_ID });
    github.getPrDetails.mockResolvedValue(null);

    await tracker.detectFromDm(PR_URL, USER_ID, SENDER_NAME);

    expect(notion.createPrReview).toHaveBeenCalledWith(DB_ID, expect.objectContaining({
      assignee: SENDER_NAME,
    }));
  });

  it('does not throw when getPrDetails rejects', async () => {
    seedUser({ notion_database_id: DB_ID });
    github.getPrDetails.mockRejectedValue(new Error('GitHub API unavailable'));

    // detectFromDm catches internally and should not propagate
    await expect(tracker.detectFromDm(PR_URL, USER_ID, SENDER_NAME)).resolves.toBeNull();
  });

  it('calls createPrReview again for duplicate URL — dedup is handled by Notion', async () => {
    seedUser({ notion_database_id: DB_ID });

    await tracker.detectFromDm(PR_URL, USER_ID, SENDER_NAME);
    await tracker.detectFromDm(PR_URL, USER_ID, SENDER_NAME);

    // Both calls go to Notion — Notion deduplicates internally
    expect(notion.createPrReview).toHaveBeenCalledTimes(2);
  });
});

describe('PR Detection Pipeline — refreshPrsForUser', () => {
  const PR_URL_A = 'https://github.com/org/repo/pull/10';
  const PR_URL_B = 'https://github.com/org/repo/pull/20';

  it('upserts PRs returned by getReviewRequests into Notion', async () => {
    seedUser({ github_username: 'alice', notion_database_id: DB_ID });
    github.getReviewRequests.mockResolvedValue([
      { prUrl: PR_URL_A, title: 'PR A', author: 'bob' },
      { prUrl: PR_URL_B, title: 'PR B', author: 'carol' },
    ]);
    notion.queryPrReviews.mockResolvedValue([]);

    await tracker.refreshPrsForUser(USER_ID);

    expect(notion.createPrReview).toHaveBeenCalledTimes(2);
    const calls = notion.createPrReview.mock.calls.map(c => c[1].prUrl);
    expect(calls).toContain(PR_URL_A);
    expect(calls).toContain(PR_URL_B);
  });

  it('marks a pending Notion PR as Done when GitHub says it is merged', async () => {
    seedUser({ github_username: 'alice', notion_database_id: DB_ID });

    // No review requests — the PR was merged and removed from the queue
    github.getReviewRequests.mockResolvedValue([]);
    github.getPrDetails.mockResolvedValue({
      state: 'merged', title: 'PR A', author: 'bob', merged: true, reviewStatus: 'approved',
    });
    // Notion reports one open PR
    notion.queryPrReviews.mockResolvedValue([
      { id: 'page-1', url: PR_URL_A, title: 'PR A', assignee: 'bob', status: 'Open', created: new Date().toISOString() },
    ]);

    await tracker.refreshPrsForUser(USER_ID);

    expect(notion.updatePrReview).toHaveBeenCalledWith(DB_ID, PR_URL_A, expect.objectContaining({
      status: 'done',
      ghState: 'merged',
    }));
  });

  it('marks a pending Notion PR as Done when GitHub says it is closed', async () => {
    seedUser({ github_username: 'alice', notion_database_id: DB_ID });

    github.getReviewRequests.mockResolvedValue([]);
    github.getPrDetails.mockResolvedValue({
      state: 'closed', title: 'Old PR', author: 'dan', merged: false,
    });
    notion.queryPrReviews.mockResolvedValue([
      { id: 'page-2', url: PR_URL_A, title: 'Old PR', assignee: 'dan', status: 'Open', created: new Date().toISOString() },
    ]);

    await tracker.refreshPrsForUser(USER_ID);

    expect(notion.updatePrReview).toHaveBeenCalledWith(DB_ID, PR_URL_A, expect.objectContaining({
      status: 'done',
      ghState: 'closed',
    }));
  });

  it('updates GH State on Notion for PRs still in the review queue', async () => {
    seedUser({ github_username: 'alice', notion_database_id: DB_ID });

    github.getReviewRequests.mockResolvedValue([
      { prUrl: PR_URL_B, title: 'Active PR', author: 'eve' },
    ]);
    github.getPrDetails.mockResolvedValue({
      state: 'open', title: 'Active PR', author: 'eve', merged: false, reviewStatus: 'pending',
    });
    notion.queryPrReviews.mockResolvedValue([
      { id: 'page-3', url: PR_URL_B, title: 'Active PR', assignee: 'eve', status: 'Open', created: new Date().toISOString() },
    ]);

    await tracker.refreshPrsForUser(USER_ID);

    expect(notion.updatePrReview).toHaveBeenCalledWith(DB_ID, PR_URL_B, expect.objectContaining({
      ghState: 'open',
      reviewStatus: 'pending',
    }));
  });

  it('does nothing when user does not exist', async () => {
    await expect(tracker.refreshPrsForUser('U-NONEXISTENT')).resolves.toBeUndefined();
    expect(github.getReviewRequests).not.toHaveBeenCalled();
  });

  it('skips GitHub API call when user has no github_username', async () => {
    seedUser({ notion_database_id: DB_ID }); // no github_username

    await tracker.refreshPrsForUser(USER_ID);

    expect(github.getReviewRequests).not.toHaveBeenCalled();
  });

  it('skips Notion operations when user has no notion_database_id', async () => {
    seedUser({ github_username: 'alice' }); // no notion_database_id
    github.getReviewRequests.mockResolvedValue([
      { prUrl: PR_URL_A, title: 'PR A', author: 'bob' },
    ]);

    await tracker.refreshPrsForUser(USER_ID);

    expect(notion.createPrReview).not.toHaveBeenCalled();
    expect(notion.queryPrReviews).not.toHaveBeenCalled();
  });
});
