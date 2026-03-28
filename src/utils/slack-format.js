/**
 * Shared utilities for parsing Slack message formatting.
 *
 * Slack auto-converts user input:
 *   #channel-name  →  <#C0A6GNR0Y0G|channel-name>
 *   @user          →  <@U071RRL7Y5S>
 *   URLs           →  <https://example.com|example.com>
 *
 * All handlers that receive user input must use these utilities
 * to extract clean values.
 */

/**
 * Extract channel name from any format.
 * Handles: <#C0A6GNR0Y0G|channel-name>, C0A6GNR0Y0G, #channel-name, channel-name
 * @returns {{ id: string|null, name: string }}
 */
function parseChannel(value) {
  if (!value) return { id: null, name: '' };

  // Slack auto-link: <#C0A6GNR0Y0G|channel-name>
  const slackMatch = value.match(/<#([A-Z0-9]+)\|([^>]+)>/);
  if (slackMatch) return { id: slackMatch[1], name: slackMatch[2] };

  // Raw channel ID: C0A6GNR0Y0G
  if (/^C[A-Z0-9]{8,}$/.test(value)) return { id: value, name: null };

  // Plain name (with or without #)
  return { id: null, name: value.replace('#', '').toLowerCase() };
}

/**
 * Resolve a channel to { id, name } using Slack API if needed.
 */
async function resolveChannel(value, slackClient) {
  const parsed = parseChannel(value);

  // Already have both
  if (parsed.id && parsed.name) return parsed;

  // Have ID, need name
  if (parsed.id) {
    try {
      const info = await slackClient.conversations.info({ channel: parsed.id });
      return { id: parsed.id, name: info.channel?.name || parsed.id };
    } catch {
      return { id: parsed.id, name: parsed.id };
    }
  }

  // Have name, need ID
  const channelList = await slackClient.conversations.list({ types: 'public_channel,private_channel', limit: 200 });
  const found = channelList.channels.find(c => c.name === parsed.name);
  if (found) return { id: found.id, name: found.name };

  return null;
}

/**
 * Extract user ID from Slack format: <@U071RRL7Y5S> → U071RRL7Y5S
 */
function parseUser(value) {
  if (!value) return null;
  const match = value.match(/<@([A-Z0-9]+)>/);
  return match ? match[1] : value;
}

/**
 * Extract URL from Slack format: <https://example.com|example.com> → https://example.com
 */
function parseUrl(value) {
  if (!value) return null;
  const match = value.match(/<([^|>]+)(?:\|[^>]+)?>/);
  return match ? match[1] : value;
}

module.exports = { parseChannel, resolveChannel, parseUser, parseUrl };
