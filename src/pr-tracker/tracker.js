const gemini = require('../integrations/gemini');
const log = require('../utils/logger').child({ module: 'pr' });
const github = require('../integrations/github');
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
 * Detect PR from a DM message. Returns detection info if found (for conversation context).
 */
async function detectFromDm(messageText, userId, senderName) {
  // Extract GitHub PR URLs directly from Slack-formatted text
  const urlMatch = messageText.match(/https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/);
  if (!urlMatch && !messageText.match(/github\.com.*\/pull\//i) && !messageText.match(/pull.*request/i)) return null;

  log.info('DM contains PR link, detecting');

  try {
    let prUrl;

    // Try direct URL extraction first (faster, no Gemini call)
    if (urlMatch) {
      prUrl = urlMatch[0].replace(/\/(files|changes|commits|checks).*$/, '');
    } else {
      // Fall back to Gemini for less obvious PR references
      const result = await gemini.askJson(DETECT_PROMPT, `From: ${senderName}\nMessage: ${messageText}`);
      if (!result.is_pr || !result.pr_url) return null;
      prUrl = result.pr_url.replace(/\/(files|changes|commits|checks).*$/, '');
    }

    const details = await github.getPrDetails(prUrl);

    const user = userStore.getById(userId);
    let isNew = false;

    if (user?.notion_database_id) {
      // Write directly to Notion — createPrReview deduplicates by URL
      const page = await notion.createPrReview(user.notion_database_id, {
        prUrl,
        context: details?.title || 'PR',
        assignee: details?.author || senderName,
      });
      // createPrReview returns the existing page when already tracked
      isNew = !!page?.id;
    }

    log.info({ prUrl, author: details?.author || senderName, isNew }, 'Tracked from DM');
    return { prUrl, title: details?.title, author: details?.author, isNew };
  } catch (err) {
    log.error({ err }, 'DM detection failed');
    return null;
  }
}

/**
 * Refresh PRs for a user — called on-demand when user asks "what PRs need my review?"
 * Reads from GitHub as the live source and writes to Notion as the only store.
 */
async function refreshPrsForUser(userId) {
  const user = userStore.getById(userId);
  if (!user) return;

  const dbId = user.notion_database_id;

  // Fetch individually-assigned review requests from GitHub (live source of truth)
  const ghPrs = user.github_username
    ? await github.getReviewRequests(user.github_username)
    : [];
  const ghUrls = new Set(ghPrs.map(pr => pr.prUrl));

  // Upsert GitHub PRs into Notion (createPrReview handles dedup)
  if (dbId) {
    for (const pr of ghPrs) {
      try {
        await notion.createPrReview(dbId, {
          prUrl: pr.prUrl,
          context: pr.title,
          assignee: pr.author,
        });
      } catch (err) {
        log.error({ err, prUrl: pr.prUrl }, 'Failed to upsert PR into Notion');
      }
    }
  }

  // Query current open PRs from Notion
  const pending = dbId ? await notion.queryPrReviews(dbId, 'open') : [];

  for (const pr of pending) {
    if (ghUrls.has(pr.url)) {
      // Still assigned — fetch details to update GH State / Review Status in Notion
      if (dbId) {
        const details = await github.getPrDetails(pr.url);
        if (details) {
          await notion.updatePrReview(dbId, pr.url, {
            ghState: details.state,
            reviewStatus: details.reviewStatus || 'pending',
          }).catch(err => log.error({ err }, 'Failed to update Notion PR state'));
        }
      }
    } else {
      // Not in individual review queue — check if PR is actually merged/closed
      const details = await github.getPrDetails(pr.url);

      if (details?.merged || details?.state === 'closed') {
        // PR is genuinely merged/closed — mark Done in Notion
        const state = details.merged ? 'merged' : 'closed';
        if (dbId) {
          await notion.updatePrReview(dbId, pr.url, {
            status: 'done',
            ghState: state,
          }).catch(err => log.error({ err }, 'Failed to mark PR done'));
          log.info({ prUrl: pr.url, state }, 'Notion marked Done');
        }
      } else if (details && dbId) {
        // PR is still open — update state without changing Status (keep Open)
        await notion.updatePrReview(dbId, pr.url, {
          ghState: details.state,
          reviewStatus: details.reviewStatus || 'pending',
        }).catch(err => log.error({ err }, 'Failed to update open PR state'));
      }
    }
  }
}

module.exports = { detectFromDm, refreshPrsForUser };
