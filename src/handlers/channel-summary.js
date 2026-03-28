const gemini = require('../integrations/gemini');
const { resolveChannel } = require('../utils/slack-format');

const SUMMARY_PROMPT = `You are Donna, a Slack assistant. Summarize the following Slack channel messages concisely.
Focus on key decisions, action items, announcements, and unresolved questions.
Keep it brief (5-10 bullet points max). Use Slack formatting (*bold*, _italic_).`;

async function handle(params, slackClient) {
  const { channel, timeframe } = params;

  try {
    const resolved = await resolveChannel(channel, slackClient);
    if (!resolved) return `I couldn't find that channel. Make sure I'm added to it.`;

    let oldest;
    const now = Date.now() / 1000;
    if (timeframe && timeframe.includes('hour')) {
      const hours = parseInt(timeframe.match(/(\d+)/)?.[1] || '3');
      oldest = now - (hours * 3600);
    } else if (timeframe === 'yesterday') {
      oldest = now - 86400;
    } else {
      oldest = now - 43200;
    }

    // Join channel if not already a member
    try { await slackClient.conversations.join({ channel: resolved.id }); } catch { /* expected: already a member or insufficient perms */ }

    const history = await slackClient.conversations.history({
      channel: resolved.id, oldest: String(oldest), limit: 100,
    });

    if (!history.messages?.length) return `No messages in #${resolved.name} for that timeframe.`;

    const messagesText = history.messages.reverse()
      .filter(m => !m.subtype || m.subtype === 'bot_message')
      .map(m => m.text || '').join('\n---\n');

    const summary = await gemini.ask(SUMMARY_PROMPT,
      `Channel: #${resolved.name}\nTimeframe: ${timeframe || 'today'}\nMessages:\n${messagesText}`);

    return `*Summary of #${resolved.name}* (${timeframe || 'today'}):\n\n${summary}`;
  } catch (err) {
    console.error('Channel summary failed:', err.message);
    return `Failed to summarize: ${err.message}`;
  }
}

module.exports = { handle };
