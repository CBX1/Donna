const triageLogStore = require('../stores/triage-log-store');
const db = require('../db');
const { todayIST } = require('../utils/time');

/**
 * Get unread attention messages by checking Slack read position.
 */
async function getUnreadAttention(userId, slackClient, userToken) {
  const today = todayIST();
  const allAttention = db.prepare(
    "SELECT * FROM triage_log WHERE user_id = ? AND classification = 'attention' AND log_date = ? ORDER BY logged_at"
  ).all(userId, today);

  if (allAttention.length === 0) return { byChannel: {}, total: 0 };

  // If no user token, can't check read status — return all
  if (!userToken) {
    const byChannel = {};
    allAttention.forEach(e => { byChannel[e.channel_name] = (byChannel[e.channel_name] || 0) + 1; });
    return { byChannel, total: allAttention.length };
  }

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

  const unread = allAttention.filter(e => {
    const msgTs = parseFloat(e.message_ts || '0');
    const lastRead = lastReadByChannel[e.channel_id] || 0;
    return msgTs > lastRead;
  });

  const byChannel = {};
  unread.forEach(e => { byChannel[e.channel_name] = (byChannel[e.channel_name] || 0) + 1; });
  return { byChannel, total: unread.length };
}

async function handle(userId, slackClient, userToken) {
  // Get new noise since last query (advances noise timestamp)
  const noiseStats = triageLogStore.getNewNoiseSinceLastQuery(userId);

  // Get unread attention — independent of any timestamp, purely based on Slack read status
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
