const gemini = require('../integrations/gemini');
const log = require('../utils/logger').child({ module: 'pr' });
const github = require('../integrations/github');
const prStore = require('../stores/pr-store');
const notion = require('../integrations/notion');
const userStore = require('../stores/user-store');

const DETECT_PROMPT = `You detect Pull Request links in Slack DMs.

Respond with ONLY a JSON object:
{
  "is_pr": true/false,
  "pr_url": "<full GitHub PR URL or null>"
}

Track any message containing a GitHub PR link (github.com/.../pull/...).
Do NOT track: general discussion without links, "I merged PR #42" (already done).`;

/**
 * Detect PR from a DM message. Non-blocking.
 */
async function detectFromDm(messageText, userId, senderName) {
  // Extract GitHub PR URLs directly from Slack-formatted text
  const urlMatch = messageText.match(/https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/);
  if (!urlMatch && !messageText.match(/github\.com.*\/pull\//i) && !messageText.match(/pull.*request/i)) return;

  log.info('DM contains PR link, detecting');

  try {
    let prUrl;

    // Try direct URL extraction first (faster, no Gemini call)
    if (urlMatch) {
      prUrl = urlMatch[0].replace(/\/(files|changes|commits|checks).*$/, '');
    } else {
      // Fall back to Gemini for less obvious PR references
      const result = await gemini.askJson(DETECT_PROMPT, `From: ${senderName}\nMessage: ${messageText}`);
      if (!result.is_pr || !result.pr_url) return;
      prUrl = result.pr_url.replace(/\/(files|changes|commits|checks).*$/, '');
    }

    const details = await github.getPrDetails(prUrl);

    const added = prStore.upsert(userId, {
      prUrl,
      title: details?.title || 'PR',
      author: details?.author || senderName,
      detectedFrom: 'dm',
    });

    // Always sync to Notion
    await syncPrToNotion(userId, prUrl, details?.title || 'PR', details?.author || senderName);

    log.info({ prUrl, author: details?.author || senderName, isNew: added }, 'Tracked from DM');
  } catch (err) {
    log.error({ err }, 'DM detection failed');
  }
}

/**
 * Refresh PRs for a user — called on-demand when user asks "what PRs need my review?"
 */
async function refreshPrsForUser(userId) {
  const user = userStore.getById(userId);
  if (!user) return;

  // Fetch individually-assigned review requests from GitHub (source of truth)
  const ghPrs = user.github_username
    ? await github.getReviewRequests(user.github_username)
    : [];
  const ghUrls = new Set(ghPrs.map(pr => pr.prUrl));

  // Upsert GitHub PRs + sync to Notion
  for (const pr of ghPrs) {
    prStore.upsert(userId, {
      prUrl: pr.prUrl,
      title: pr.title,
      author: pr.author,
      detectedFrom: 'github_api',
    });
    await syncPrToNotion(userId, pr.prUrl, pr.title, pr.author);
  }

  // Clean up pending PRs that are no longer in the user's individual review queue
  const pending = prStore.getPending(userId);
  for (const pr of pending) {
    if (ghUrls.has(pr.pr_url)) {
      // Still assigned — fetch details to update review status
      const details = await github.getPrDetails(pr.pr_url);
      if (details) prStore.updateGhState(userId, pr.pr_url, details.state, details.reviewStatus);
    } else {
      // Not in individual review queue — check if PR is actually merged/closed
      const details = await github.getPrDetails(pr.pr_url);

      if (details?.merged || details?.state === 'closed') {
        // PR is genuinely merged/closed — terminal state, remove from both DB and Notion
        const state = details.merged ? 'merged' : 'closed';
        prStore.markMergedOrClosed(userId, pr.pr_url, state);
        await markPrDoneInNotion(userId, pr.pr_url);
        log.info({ prUrl: pr.pr_url, state }, 'DB + Notion marked Done');
      } else {
        // PR is still open — keep tracking regardless of assignment
        // Mark as 'reviewed' (still shows in pending list) — do NOT touch Notion
        if (details) prStore.updateGhState(userId, pr.pr_url, details.state, details.reviewStatus || 'pending');
      }
    }
  }
}

/**
 * Sync a PR to user's Notion database.
 */
async function syncPrToNotion(userId, prUrl, title, author) {
  const user = userStore.getById(userId);
  if (!user?.notion_database_id) return;

  try {
    await notion.createPrReview(user.notion_database_id, {
      prUrl,
      context: title,
      assignee: author,
    });
  } catch (err) {
    // Might already exist or Notion error — not critical
    log.error({ err }, 'Notion sync failed');
  }
}

/**
 * Mark a PR as Done in Notion when it's merged/closed.
 */
async function markPrDoneInNotion(userId, prUrl) {
  const user = userStore.getById(userId);
  if (!user?.notion_database_id) return;

  try {
    await notion.markPrDoneByUrl(user.notion_database_id, prUrl);
    log.info({ prUrl }, 'Notion marked Done');
  } catch (err) {
    log.error({ err }, 'Notion status update failed');
  }
}

module.exports = { detectFromDm, refreshPrsForUser };
