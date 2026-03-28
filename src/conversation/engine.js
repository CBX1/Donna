const gemini = require('../integrations/gemini');
const conversationStore = require('../stores/conversation-store');
const triageLogStore = require('../stores/triage-log-store');
const triageRulesStore = require('../stores/triage-rules-store');
const prStore = require('../stores/pr-store');
const reminderStore = require('../stores/reminder-store');
const userStore = require('../stores/user-store');
const userRegistry = require('../core/user-registry');
const config = require('../config');

function getSystemPrompt(userId) {
  const user = userStore.getById(userId);
  const todayStats = triageLogStore.getTodayStats(userId);
  const pendingPrs = prStore.getPending(userId);
  const rulesSummary = triageRulesStore.getUserRulesSummary(userId);
  const channels = userRegistry.getTriageChannels(userId);
  const uptime = process.uptime();
  const uptimeStr = uptime > 3600
    ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
    : `${Math.floor(uptime / 60)}m`;

  return `You are Donna — inspired by Donna Paulsen from Suits. You're an AI Slack assistant.

Your personality:
- Sassy, witty, confident, and sharp. You don't sugarcoat.
- "I'm Donna. I know everything." — and you live up to it.
- Fiercely loyal, genuinely helpful, but with an edge.
- Dry humor, light sarcasm. Warm underneath the sass.
- Self-aware about being an AI but own it with confidence.

Your state for ${user?.display_name || 'this user'}:
- Uptime: ${uptimeStr}
- Triage channels: ${channels.length}
- Today's triage: ${todayStats.totalNoise} noise cleared, ${todayStats.totalAttention} needing attention
- Auto-read channels: ${rulesSummary.autoRead.length > 0 ? rulesSummary.autoRead.join(', ') : 'none'}
- Pending PRs: ${pendingPrs.length}
- GitHub: ${user?.github_username || 'not configured'}
- Notion: ${user?.notion_database_id ? 'connected' : 'not connected'}

Your capabilities:
Alert triage, PR tracking, task management (Notion), reminders, channel summaries, daily summary, mention watch, Google Calendar (coming soon), self-evolution (admin only).

Tech stack: Node.js, Slack Bolt (Socket Mode), Gemini 2.0 Flash, SQLite, GitHub API, Notion API.

Be conversational. Help debug yourself if asked. Keep responses concise.`;
}

async function converse(userId, userMessage) {
  const history = conversationStore.getHistory(userId);

  // Format history for Gemini
  const geminiHistory = history.map(h => ({
    role: h.role,
    parts: h.parts,
  }));

  const response = await gemini.chat(getSystemPrompt(userId), geminiHistory, userMessage);
  return response;
}

module.exports = { converse };
