const gemini = require('../integrations/gemini');
const log = require('../utils/logger').child({ module: 'conversation' });
const conversationStore = require('../stores/conversation-store');
const triageLogStore = require('../stores/triage-log-store');
const triageRulesStore = require('../stores/triage-rules-store');
const prStore = require('../stores/pr-store');
const userStore = require('../stores/user-store');
const userRegistry = require('../core/user-registry');
const permissions = require('../core/permissions');
const { getGeminiFunctionDeclarations, getTool } = require('../skills/tools');
const metrics = require('../core/metrics');

const MAX_TOOL_ROUNDS = 3; // prevent infinite tool loops

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
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  return `You are Donna — inspired by Donna Paulsen from Suits. You're an AI Slack assistant.

Your personality:
- Sassy, witty, confident, and sharp. You don't sugarcoat.
- "I'm Donna. I know everything." — and you live up to it.
- Fiercely loyal, genuinely helpful, but with an edge.
- Dry humor, light sarcasm. Warm underneath the sass.
- Self-aware about being an AI but own it with confidence.

Current time: ${now}

Your state for ${user?.display_name || 'this user'}:
- Uptime: ${uptimeStr}
- Triage channels: ${channels.length}
- Today's triage: ${todayStats.totalNoise} noise cleared, ${todayStats.totalAttention} needing attention
- Auto-read channels: ${rulesSummary.autoRead.length > 0 ? rulesSummary.autoRead.join(', ') : 'none'}
- Pending PRs: ${pendingPrs.length}
- GitHub: ${user?.github_username || 'not configured'}
- Notion: ${user?.notion_database_id ? 'connected' : 'not connected'}
- Google Calendar: ${user?.google_refresh_token ? 'connected' : 'not connected'}
- Is admin: ${permissions.isAdmin(userId) ? 'yes' : 'no'}

IMPORTANT INSTRUCTIONS:
- Use the available tools/functions when the user asks you to DO something (check PRs, create tasks, set reminders, etc.)
- For purely conversational messages (greetings, questions about yourself, chitchat), respond directly without calling tools.
- You can call multiple tools in one response if needed.
- Use conversation history to understand references like "it", "that", "the first one", "yes do that".
- If a tool requires parameters you don't have, ask the user to clarify.
- When presenting tool results, format them nicely for Slack (use *bold*, bullet points, etc.)
- Keep responses concise and on-point.
- If a tool is admin-only and the user is not admin, politely refuse.`;
}

/**
 * Main conversation handler with tool use.
 * Replaces both intent-router.js and the old converse().
 */
async function converse(userId, userMessage, ctx) {
  const history = conversationStore.getHistory(userId);

  // Format history for Gemini
  const geminiHistory = history.map(h => ({
    role: h.role,
    parts: h.parts,
  }));

  const functionDeclarations = getGeminiFunctionDeclarations();
  const systemPrompt = getSystemPrompt(userId);

  // First Gemini call — may return text, tool calls, or both
  let result = await gemini.chatWithTools(
    systemPrompt, geminiHistory, userMessage, functionDeclarations
  );

  // Process tool calls in a loop (Gemini may chain calls)
  let rounds = 0;
  while (result.functionCalls.length > 0 && rounds < MAX_TOOL_ROUNDS) {
    rounds++;
    const toolResults = [];

    for (const call of result.functionCalls) {
      const tool = getTool(call.name);
      if (!tool) {
        toolResults.push({ name: call.name, result: `Unknown tool: ${call.name}` });
        continue;
      }

      // Check admin permission
      if (tool.adminOnly && !permissions.isAdmin(userId)) {
        toolResults.push({ name: call.name, result: 'Permission denied: admin only.' });
        continue;
      }

      try {
        log.info({ tool: call.name, args: call.args }, 'tool call');
        metrics.increment('toolCalls');
        const handlerResult = await tool.handler(userId, call.args, ctx);
        toolResults.push({ name: call.name, result: handlerResult || 'Done.' });
      } catch (err) {
        log.error({ err, tool: call.name }, 'tool call failed');
        toolResults.push({ name: call.name, result: `Error: ${err.message}` });
      }
    }

    // Feed results back to Gemini for final response
    result = await gemini.sendToolResults(result.chatSession, toolResults);
  }

  return result.text;
}

module.exports = { converse };
