const triageRulesStore = require('../stores/triage-rules-store');
const { resolveChannel } = require('../utils/slack-format');

async function handleAdd(userId, params, slackClient) {
  if (params.type === 'channel') {
    const resolved = await resolveChannel(params.value, slackClient);
    const chName = resolved?.name || params.value.replace(/[<#>|]/g, '');
    const added = triageRulesStore.addAutoReadChannel(userId, chName);
    return added
      ? `Consider #${chName} handled. I'll auto-clear everything there from now on.`
      : `#${chName} is already on my auto-clear list. I'm one step ahead, as usual.`;
  } else {
    const added = triageRulesStore.addIgnorePattern(userId, params.value);
    return added
      ? `Noted. Anything matching "${params.value}" gets the silent treatment from now on.`
      : `"${params.value}" is already being ignored. I don't need to be told twice.`;
  }
}

async function handleRemove(userId, params, slackClient) {
  if (params.type === 'channel') {
    const resolved = await resolveChannel(params.value, slackClient);
    const chName = resolved?.name || params.value.replace(/[<#>|]/g, '');
    const removed = triageRulesStore.removeAutoReadChannel(userId, chName);
    return removed
      ? `Alright, #${chName} is back on my radar.`
      : `#${chName} wasn't on my auto-clear list to begin with.`;
  } else {
    const removed = triageRulesStore.removeIgnorePattern(userId, params.value);
    return removed
      ? `"${params.value}" is back on my watchlist. I'll flag those again.`
      : `"${params.value}" wasn't being ignored.`;
  }
}

function handleList(userId) {
  const summary = triageRulesStore.getUserRulesSummary(userId);
  const channelLines = summary.autoRead.length > 0
    ? summary.autoRead.map(c => `  • #${c}`).join('\n')
    : '  None';
  const patternLines = summary.ignorePatterns.length > 0
    ? summary.ignorePatterns.map(p => `  • "${p}"`).join('\n')
    : '  None';
  const channelRuleLines = summary.channelDefaults.length > 0
    ? summary.channelDefaults.map(c => {
        const alerts = summary.channelAlerts.filter(a => a.channel_name === c.channel_name);
        const alertStr = alerts.length > 0 ? ` (alert on: ${alerts.map(a => `"${a.pattern}"`).join(', ')})` : '';
        return `  • #${c.channel_name}: default ${c.default_action}${alertStr}`;
      }).join('\n')
    : '';

  let response = `*Here's how I'm configured for you:*\n\n*Auto-clear channels:*\n${channelLines}\n\n*Ignore patterns:*\n${patternLines}`;
  if (channelRuleLines) response += `\n\n*Channel-specific rules:*\n${channelRuleLines}`;
  response += '\n\n_Want to change something? Just tell me._';
  return response;
}

module.exports = { handleAdd, handleRemove, handleList };
