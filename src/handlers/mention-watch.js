const mentionWatchStore = require('../stores/mention-watch-store');
const userStore = require('../stores/user-store');
const { resolveChannel } = require('../utils/slack-format');

async function handleAdd(userId, params, slackClient) {
  const resolved = await resolveChannel(params.channel, slackClient);
  if (!resolved) return `Couldn't find that channel.`;

  const user = userStore.getById(userId);
  const name = user?.display_name?.split(' ')[0]?.toLowerCase() || '';
  const patterns = [name, userId].filter(Boolean);

  mentionWatchStore.add(userId, resolved.id, resolved.name, patterns);
  return `I'll DM you whenever you're mentioned in #${resolved.name}. I've got your back.`;
}

async function handleRemove(userId, params, slackClient) {
  const resolved = await resolveChannel(params.channel, slackClient);
  if (!resolved) return `Couldn't find that channel.`;

  const removed = mentionWatchStore.remove(userId, resolved.id);
  return removed
    ? `Stopped watching #${resolved.name} for your mentions.`
    : `I wasn't watching #${resolved.name} for you.`;
}

function handleList(userId) {
  const watches = mentionWatchStore.getForUser(userId);
  if (watches.length === 0) return "You're not watching any channels for mentions.";

  const lines = watches.map(w => `  • #${w.channel_name} (watching for: ${w.patterns.join(', ')})`);
  return `*Channels I'm watching for your mentions:*\n${lines.join('\n')}`;
}

module.exports = { handleAdd, handleRemove, handleList };
