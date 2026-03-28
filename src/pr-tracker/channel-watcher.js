const cron = require('node-cron');
const notion = require('../integrations/notion');
const store = require('./store');
const config = require('../config');

// Track last processed timestamp per channel
const lastProcessed = {};
// Track already-checked PR URLs to avoid re-checking
const checkedPrs = new Set();

/**
 * Start watching PR channels for review requests assigned to the user.
 */
function start(botClient) {
  const channels = config.prWatch.channels;
  if (channels.length === 0) {
    console.log('⚠️  No PR watch channels configured');
    return;
  }

  console.log(`👀 PR watcher started — monitoring ${channels.length} channels every 5 min`);

  cron.schedule('*/5 * * * *', async () => {
    for (const channelId of channels) {
      try {
        await scanChannel(botClient, channelId);
      } catch (err) {
        console.error(`[PR Watch] Error scanning ${channelId}:`, err.message);
      }
    }
  });

  // Initial scan (last 4 hours)
  (async () => {
    for (const channelId of channels) {
      try {
        await scanChannel(botClient, channelId, true);
      } catch (err) {
        console.error(`[PR Watch] Initial scan error for ${channelId}:`, err.message);
      }
    }
  })();
}

/**
 * Extract all GitHub PR URLs from a message (text + attachments + blocks).
 */
function extractPrUrls(msg) {
  let fullText = msg.text || '';
  if (msg.attachments) {
    for (const att of msg.attachments) {
      fullText += ' ' + (att.text || att.fallback || att.title || '');
      if (att.title_link) fullText += ' ' + att.title_link;
    }
  }
  if (msg.blocks) {
    for (const block of msg.blocks) {
      if (block.text?.text) fullText += ' ' + block.text.text;
      if (block.elements) {
        for (const el of block.elements) {
          if (el.url) fullText += ' ' + el.url;
          if (el.text) fullText += ' ' + (typeof el.text === 'string' ? el.text : el.text.text || '');
          if (el.elements) {
            for (const sub of el.elements) {
              if (sub.url) fullText += ' ' + sub.url;
              if (sub.text) fullText += ' ' + sub.text;
            }
          }
        }
      }
    }
  }

  // Match GitHub PR URLs
  const urls = new Set();
  const regex = /https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/g;
  let match;
  while ((match = regex.exec(fullText)) !== null) {
    urls.add(match[0].split('?')[0]); // strip query params
  }
  return [...urls];
}

/**
 * Check if the user is a requested reviewer on a GitHub PR.
 * Returns { isReviewer, title, author } or null on error.
 */
async function checkIfReviewer(prUrl) {
  if (!config.github.token || !config.github.username) return null;

  // Parse URL: https://github.com/owner/repo/pull/123
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;

  const [, owner, repo, prNumber] = match;

  try {
    // Get PR details
    const prResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
      headers: {
        'Authorization': `Bearer ${config.github.token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!prResponse.ok) return null;
    const pr = await prResponse.json();

    // Check requested reviewers
    const isReviewer = pr.requested_reviewers?.some(
      r => r.login.toLowerCase() === config.github.username.toLowerCase()
    );

    // Also check review request teams (if user is in a requested team)
    // For now just check individual reviewers

    return {
      isReviewer,
      title: pr.title,
      author: pr.user?.login || 'unknown',
      state: pr.state,
    };
  } catch (err) {
    console.error(`[PR Watch] GitHub API error for ${prUrl}:`, err.message);
    return null;
  }
}

async function scanChannel(botClient, channelId, isInitial = false) {
  const oldest = isInitial
    ? String(Date.now() / 1000 - 14400) // last 4 hours on startup
    : (lastProcessed[channelId] || String(Date.now() / 1000 - 300));

  const history = await botClient.conversations.history({
    channel: channelId,
    oldest,
    limit: isInitial ? 100 : 50,
  });

  const messages = (history.messages || []).reverse();
  if (messages.length === 0) return;

  lastProcessed[channelId] = messages[messages.length - 1].ts;

  for (const msg of messages) {
    const prUrls = extractPrUrls(msg);

    for (const prUrl of prUrls) {
      // Skip if already checked
      if (checkedPrs.has(prUrl)) continue;
      checkedPrs.add(prUrl);

      const result = await checkIfReviewer(prUrl);
      if (!result) continue;

      if (result.isReviewer && result.state === 'open') {
        const prData = {
          prUrl,
          context: result.title.substring(0, 60),
          assignee: result.author,
        };

        const added = store.add(prData);
        if (added) {
          try {
            await notion.createPrReview(prData);
          } catch {}
          console.log(`[PR Watch] Tracked: ${prUrl} (by ${result.author})`);
        }
      }
    }
  }
}

module.exports = { start };
