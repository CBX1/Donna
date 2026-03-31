const prTracker = require('../pr-tracker/tracker');
const notion = require('../integrations/notion');
const userStore = require('../stores/user-store');
const { formatAge } = require('../utils/time');

async function handle(userId) {
  const user = userStore.getById(userId);

  if (!user?.notion_database_id) {
    return "I don't have a Notion database set up for you yet. Tell me to set up or share a Notion database link.";
  }

  // Refresh from GitHub + sync state to Notion
  await prTracker.refreshPrsForUser(userId);

  // Read pending PRs from Notion (Type='PR Review', Status='Open')
  const alive = await notion.queryPrReviews(user.notion_database_id, 'open');

  if (alive.length === 0) return "Clean slate — no PRs waiting on you. Go grab a coffee.";

  const lines = alive.map(pr => {
    const reviewStatus = pr.reviewStatus ? ` _(${pr.reviewStatus})_` : '';
    const draft = pr.ghState === 'draft' ? ' _(draft)_' : '';
    return `• <${pr.url}|${pr.title || 'PR'}> — by ${pr.assignee}, ${formatAge(pr.created)}${reviewStatus}${draft}`;
  });

  const header = alive.length === 1
    ? "You've got *1 PR* waiting. Don't leave them hanging:"
    : `You've got *${alive.length} PRs* piling up. Here's the lineup:`;
  return `${header}\n${lines.join('\n')}`;
}

module.exports = { handle };
