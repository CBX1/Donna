const prStore = require('../stores/pr-store');
const prTracker = require('../pr-tracker/tracker');
const { formatAge } = require('../utils/time');

async function handle(userId) {
  // Refresh from GitHub + clean up merged/closed + sync Notion
  await prTracker.refreshPrsForUser(userId);

  // Get remaining pending PRs
  const alive = prStore.getPending(userId);

  if (alive.length === 0) return "Clean slate — no PRs waiting on you. Go grab a coffee.";

  const lines = alive.map(pr => {
    const status = pr.gh_review_status ? ` _(${pr.gh_review_status})_` : '';
    const draft = pr.gh_state === 'draft' ? ' _(draft)_' : '';
    return `• <${pr.pr_url}|${pr.title || 'PR'}> — by ${pr.author}, ${formatAge(pr.created_at)}${status}${draft}`;
  });

  const header = alive.length === 1
    ? "You've got *1 PR* waiting. Don't leave them hanging:"
    : `You've got *${alive.length} PRs* piling up. Here's the lineup:`;
  return `${header}\n${lines.join('\n')}`;
}

module.exports = { handle };
