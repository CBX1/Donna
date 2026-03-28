const notion = require('../../integrations/notion');
const store = require('../../pr-tracker/store');

function formatAge(timestamp) {
  const diff = Date.now() - new Date(timestamp).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function handle(params) {
  // Try Notion first, fall back to in-memory store
  try {
    if (notion.getDatabaseId()) {
      const prs = await notion.queryByType('PR Review', 'open');
      if (prs.length === 0) return "Clean slate — no PRs waiting on you. Go grab a coffee. ☕";

      const lines = prs.map(pr =>
        `• <${pr.url}|${pr.title}> — from ${pr.assignee}, ${formatAge(pr.created)}`
      );
      const header = prs.length === 1
        ? "You've got *1 PR* waiting. Don't leave them hanging:"
        : `You've got *${prs.length} PRs* piling up. Here's the lineup:`;
      return `${header}\n${lines.join('\n')}`;
    }
  } catch (err) {
    console.error('Notion PR query failed, falling back to in-memory:', err.message);
  }

  // Fallback: in-memory store
  const pending = store.getPending();
  if (pending.length === 0) return "Clean slate — no PRs waiting on you. Go grab a coffee. ☕";

  const lines = pending.map(pr =>
    `• <${pr.prUrl}|${pr.prUrl.split('/').slice(-3).join('/')}> — ${pr.context}\n  From: ${pr.assignee}, ${formatAge(pr.timestamp)}`
  );
  const header = pending.length === 1
    ? "You've got *1 PR* waiting. Don't leave them hanging:"
    : `You've got *${pending.length} PRs* piling up. Here's the lineup:`;
  return `${header}\n${lines.join('\n')}`;
}

module.exports = { handle };
