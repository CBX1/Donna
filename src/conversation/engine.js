const gemini = require('../integrations/gemini');
const log = require('../utils/logger').child({ module: 'conversation' });
const conversationStore = require('../stores/conversation-store');
const triageLogStore = require('../stores/triage-log-store');
const triageRulesStore = require('../stores/triage-rules-store');
const notion = require('../integrations/notion');
const userStore = require('../stores/user-store');
const userRegistry = require('../core/user-registry');
const permissions = require('../core/permissions');
const { getGeminiFunctionDeclarations, getTool } = require('../skills/tools');
const metrics = require('../core/metrics');

const MAX_TOOL_ROUNDS = 3; // prevent infinite tool loops

// Cache PR counts briefly to avoid a Notion API call on every message
const prCountCache = new Map(); // userId -> { count, ts }
const PR_COUNT_TTL_MS = 60 * 1000; // 1 minute

async function getPendingPrCount(userId) {
  const user = userStore.getById(userId);
  if (!user?.notion_database_id) return 0;

  const cached = prCountCache.get(userId);
  if (cached && Date.now() - cached.ts < PR_COUNT_TTL_MS) return cached.count;

  try {
    const prs = await notion.queryPrReviews(user.notion_database_id, 'open');
    const count = prs.length;
    prCountCache.set(userId, { count, ts: Date.now() });
    return count;
  } catch {
    return cached?.count ?? 0;
  }
}

async function getSystemPrompt(userId) {
  const user = userStore.getById(userId);
  const todayStats = triageLogStore.getTodayStats(userId);
  const pendingPrCount = await getPendingPrCount(userId);
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
- Pending PRs: ${pendingPrCount}
- GitHub: ${user?.github_username || 'not configured'}
- Notion: ${user?.notion_database_id ? 'connected' : 'not connected'}
- Google Calendar: ${user?.google_refresh_token ? 'connected' : 'not connected'}
- Is admin: ${permissions.isAdmin(userId) ? 'yes' : 'no'}

HOW TO THINK:
Before choosing a tool or responding, ALWAYS read the last 5 messages in the conversation history and think about what the user actually means in context.

1. UNDERSTAND INTENT FROM CONTEXT: The user's message alone may be ambiguous. The conversation history tells you what they're really asking. "I've read it" after a triage report means "dismiss those items", not "create a permanent rule". "What did you do?" after discussing alerts means "show me the triaged messages", not "list my config".

2. DISTINGUISH DATA vs CONFIG: When the user asks about triage, figure out whether they want:
   - The actual triaged messages (data) → get_triage_status
   - Their triage settings (config) → list_triage_rules
   Read the context to decide. "What did you triage?" = data. "How are you configured?" = config.

3. DISTINGUISH ONE-TIME vs PERMANENT: When the user acknowledges something:
   - "I've read it" / "already saw that" = one-time dismiss → dismiss_attention
   - "Always auto-read that channel" / "ignore this pattern" = permanent change → add_triage_rule
   Never create permanent rules from casual acknowledgements.

4. RESOLVE REFERENCES: "it", "that", "the first one", "yes" — look at what was just discussed. If your last response listed #workflow-notifications-qa as needing attention and the user says "I read it", they mean that channel.

5. WHEN UNSURE: Ask the user to clarify rather than guessing. A wrong action (especially a permanent rule) is worse than asking.

OTHER GUIDELINES:
- For conversational messages (greetings, chitchat, questions about yourself), respond directly without tools.
- When presenting tool results, format nicely for Slack (*bold*, bullet points).
- Keep responses concise.
- Admin-only tools: politely refuse if user is not admin.`;
}

/**
 * Main conversation handler with tool use.
 * Replaces both intent-router.js and the old converse().
 */
async function converse(userId, userMessage, ctx) {
  const history = conversationStore.getHistory(userId, 10);

  // Format history for Gemini — must strictly alternate user/model
  const geminiHistory = [];
  for (const h of history) {
    const last = geminiHistory[geminiHistory.length - 1];
    if (last && last.role === h.role) {
      // Same role consecutive — merge into last entry
      last.parts[0].text += '\n' + (h.parts?.[0]?.text || '');
    } else {
      geminiHistory.push({ role: h.role, parts: [{ text: h.parts?.[0]?.text || '' }] });
    }
  }
  // Gemini requires history to start with 'user' and alternate
  if (geminiHistory.length > 0 && geminiHistory[0].role !== 'user') {
    geminiHistory.shift();
  }
  // Must end with 'model' (the last response before current user message)
  if (geminiHistory.length > 0 && geminiHistory[geminiHistory.length - 1].role === 'user') {
    geminiHistory.pop();
  }

  const functionDeclarations = getGeminiFunctionDeclarations();
  const systemPrompt = await getSystemPrompt(userId);

  // First Gemini call — may return text, tool calls, or both
  let result = await gemini.chatWithTools(
    systemPrompt, geminiHistory, userMessage, functionDeclarations
  );

  // Process tool calls in a loop (Gemini may chain calls)
  const toolsCalled = [];
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

    // Track which tools were called for history
    toolsCalled.push(...toolResults.map(r => `[${r.name}]: ${r.result.substring(0, 200)}`));

    // Feed results back to Gemini for final response
    result = await gemini.sendToolResults(result.chatSession, toolResults);
  }

  return { text: result.text, toolsCalled };
}

module.exports = { converse };
