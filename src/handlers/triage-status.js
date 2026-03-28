const triageLogStore = require('../stores/triage-log-store');
const db = require('../db');

/**
 * Get undismissed attention messages.
 * If user token available, auto-dismiss items the user has already read in Slack.
 */
async function getUnreadAttention(userId, slackClient, userToken) {
  // Get ALL undismissed attention items — persists across days/restarts
  const allAttention = db.prepare(
    "SELECT * FROM triage_log WHERE user_id = ? AND classification = 'attention' AND dismissed = 0 ORDER BY logged_at"
  ).all(userId);

  if (allAttention.length === 0) return { byChannel: {}, total: 0 };

  // If we have user token, check Slack read positions and auto-dismiss read items
  if (userToken) {
    const { WebClient } = require('@slack/web-api');
    const userClient = new WebClient(userToken);

    const channelIds = [...new Set(allAttention.map(e => e.channel_id))];
    const lastReadByChannel = {};
    for (const channelId of channelIds) {
      try {
        const info = await userClient.conversations.info({ channel: channelId });
        lastReadByChannel[channelId] = parseFloat(info.channel?.last_read || '0');
      } catch {
        lastReadByChannel[channelId] = 0;
      }
    }

    // Auto-dismiss items the user has already read past
    const dismissIds = [];
    const stillUnread = [];
    for (const e of allAttention) {
      const msgTs = parseFloat(e.message_ts || '0');
      const lastRead = lastReadByChannel[e.channel_id] || 0;
      if (msgTs <= lastRead) {
        dismissIds.push(e.id);
      } else {
        stillUnread.push(e);
      }
    }

    if (dismissIds.length > 0) {
      db.prepare(
        `UPDATE triage_log SET dismissed = 1 WHERE id IN (${dismissIds.map(() => '?').join(',')})`
      ).run(...dismissIds);
    }

    const byChannel = {};
    stillUnread.forEach(e => { byChannel[e.channel_name] = (byChannel[e.channel_name] || 0) + 1; });
    return { byChannel, total: stillUnread.length };
  }

  // No user token — return all undismissed
  const byChannel = {};
  allAttention.forEach(e => { byChannel[e.channel_name] = (byChannel[e.channel_name] || 0) + 1; });
  return { byChannel, total: allAttention.length };
}

async function handle(userId, slackClient, userToken) {
  // Get new noise since last query (advances noise timestamp)
  const noiseStats = triageLogStore.getNewNoiseSinceLastQuery(userId);

  // Get undismissed attention — persists across restarts
  const unread = await getUnreadAttention(userId, slackClient, userToken);

  // Nothing at all?
  if (noiseStats.total === 0 && unread.total === 0) {
    return "Nothing new since you last checked. I'm keeping watch — go do something productive.";
  }

  const noiseLines = Object.entries(noiseStats.byChannel)
    .map(([ch, count]) => `  • #${ch}: ${count}`)
    .join('\n');

  const attentionLines = Object.entries(unread.byChannel)
    .map(([ch, count]) => `  • #${ch}: ${count}`)
    .join('\n');

  const intro = unread.total > 0
    ? "Here's what happened while you were away. Some things need your eyes."
    : `All quiet. I handled ${noiseStats.total} messages so you didn't have to.`;

  let response = intro;

  if (noiseStats.total > 0) {
    response += `\n\n*Cleared as noise (${noiseStats.total}):*\n${noiseLines}`;
  }

  response += `\n\n*Needs your attention (${unread.total}):*\n${attentionLines || '  None'}`;

  return response;
}

module.exports = { handle };
