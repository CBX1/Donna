const claude = require('../../integrations/claude');
const { resolveChannel } = require('../../utils/slack-format');

const SUMMARY_PROMPT = `You are Donna, a Slack assistant. Summarize the following Slack channel messages concisely.
Focus on:
- Key decisions made
- Action items or requests
- Important announcements
- Any unresolved questions

Keep the summary brief (5-10 bullet points max). Use Slack formatting (*bold*, _italic_).`;

/**
 * Summarize recent messages from a Slack channel.
 */
async function handle(params, slackClient) {
  const { channel, timeframe } = params;

  try {
    const resolved = await resolveChannel(channel, slackClient);

    if (!resolved) {
      return `I couldn't find a channel called #${channel.replace(/[<#>|]/g, '')}. Make sure I'm added to it.`;
    }

    // Calculate oldest timestamp based on timeframe
    let oldest;
    const now = Date.now() / 1000;
    if (timeframe && timeframe.includes('hour')) {
      const hours = parseInt(timeframe.match(/(\d+)/)?.[1] || '3');
      oldest = now - (hours * 3600);
    } else if (timeframe === 'yesterday') {
      oldest = now - 86400;
    } else {
      // Default: today (last 12 hours)
      oldest = now - 43200;
    }

    const history = await slackClient.conversations.history({
      channel: resolved.id,
      oldest: String(oldest),
      limit: 100,
    });

    if (!history.messages || history.messages.length === 0) {
      return `No messages in #${resolved.name} for the requested timeframe.`;
    }

    const messagesText = history.messages
      .reverse()
      .filter(m => !m.subtype || m.subtype === 'bot_message')
      .map(m => m.text || '')
      .join('\n---\n');

    const summary = await claude.ask(
      SUMMARY_PROMPT,
      `Channel: #${resolved.name}\nTimeframe: ${timeframe || 'today'}\nMessages:\n${messagesText}`
    );

    return `*Summary of #${resolved.name}* (${timeframe || 'today'}):\n\n${summary}`;
  } catch (err) {
    console.error('Channel summary failed:', err.message);
    return `Failed to get summary for #${channel}: ${err.message}`;
  }
}

module.exports = { handle };
