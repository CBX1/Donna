const claude = require('../integrations/claude');
const store = require('./store');
const notion = require('../integrations/notion');
const config = require('../config');

const SYSTEM_PROMPT = `You detect Pull Request links or review requests in Slack DMs.

Given a DM, determine if it contains a GitHub PR link or is about a PR that should be tracked.

Respond with ONLY a JSON object (no markdown):
{
  "is_pr_request": true/false,
  "pr_url": "<full GitHub PR URL or null>",
  "context": "<8-9 word summary of what the PR is about, or null>"
}

Track these as PRs:
- Any message with a GitHub PR link (github.com/.../pull/...)
- "Can you review this PR?"
- "PR ready for review"
- "Take a look at this" + PR link
- Someone sharing a PR link for any reason (review, FYI, discussion)
- GitHub bot notifications about PRs

Do NOT track:
- General discussion without a PR link
- "I merged PR #42" (already done)
- Random messages with no PR content`;

/**
 * Fetch PR author from GitHub API.
 */
async function fetchPrAuthor(prUrl) {
  if (!config.github.token) return null;

  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;

  const [, owner, repo, prNumber] = match;

  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
      headers: {
        'Authorization': `Bearer ${config.github.token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });
    if (!response.ok) return null;
    const pr = await response.json();
    return {
      author: pr.user?.login || 'unknown',
      title: pr.title,
    };
  } catch {
    return null;
  }
}

/**
 * Check if a DM contains a PR and track it.
 */
async function detectAndTrack(messageText, senderName) {
  try {
    const result = await claude.askJson(SYSTEM_PROMPT, `From: ${senderName}\nMessage: ${messageText}`);

    if (result.is_pr_request && result.pr_url) {
      // Clean PR URL (strip /files, /changes, /commits suffixes)
      const cleanUrl = result.pr_url.replace(/\/(files|changes|commits|checks).*$/, '');

      // Fetch actual PR author from GitHub
      const ghInfo = await fetchPrAuthor(cleanUrl);

      const prData = {
        prUrl: cleanUrl,
        context: ghInfo?.title || result.context || 'No context available',
        assignee: ghInfo?.author || senderName,
      };

      // Save to in-memory store
      store.add(prData);

      // Save to Notion
      try {
        await notion.createPrReview(prData);
      } catch (err) {
        console.error('Failed to save PR to Notion:', err.message);
      }

      console.log(`PR tracked: ${cleanUrl} by ${prData.assignee}`);
      return { detected: true, added: true, pr: result };
    }

    return { detected: false, pr: null };
  } catch (err) {
    console.error('PR detection failed:', err.message);
    return { detected: false, pr: null };
  }
}

module.exports = { detectAndTrack };
