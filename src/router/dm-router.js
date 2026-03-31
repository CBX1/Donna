const config = require('../config');
const log = require('../utils/logger').child({ module: 'dm' });
const userRegistry = require('../core/user-registry');
const conversationStore = require('../stores/conversation-store');
const conversationEngine = require('../conversation/engine');
const health = require('../core/health');
const metrics = require('../core/metrics');

/**
 * Handle a DM message. Called from app.js.
 *
 * Design: The conversation brain (Gemini) is ALWAYS the first decision-maker.
 * The router only handles technical filtering (bot messages, missing API key).
 * All intent understanding, tool selection, and action decisions are made by the brain.
 */
async function handle({ message, say, app }) {
  // Technical filters only — not decisions
  if (message.subtype === 'bot_message' || message.bot_id) return;
  if (message.channel_type !== 'im') return;

  const text = message.text || '';
  const userId = message.user;

  try {
    if (!config.gemini.apiKey) {
      await say("Hey! I'm Donna. I'm almost ready — just need my AI brain connected. Hang tight!");
      return;
    }

    // Get/create user (needed for context, not a decision)
    let displayName = 'Unknown';
    try {
      const info = await app.client.users.info({ user: userId });
      displayName = info.user.real_name || info.user.name || 'Unknown';
    } catch (err) { log.error({ err }, 'users.info failed'); }

    userRegistry.ensureUser(userId, displayName);

    health.recordMessage();
    metrics.increment('messagesHandled');
    log.info({ text: text.substring(0, 200) }, 'DM received');

    // Context for tool handlers
    const ctx = {
      app,
      say,
      slackClient: app.client,
      sendDm: (uid, msg) => sendDm(app, uid, msg),
    };

    // Brain decides everything — what to do, which tools to call, how to respond
    const { text: response, toolsCalled } = await conversationEngine.converse(userId, text, ctx);

    // Track conversation history — include tool context so brain remembers what it did
    conversationStore.addMessage(userId, 'user', text);
    if (response) {
      const modelMsg = toolsCalled.length > 0
        ? `${toolsCalled.join('\n')}\n\n${response}`
        : response;
      conversationStore.addMessage(userId, 'model', modelMsg);
    }

    if (response) await say(response);
  } catch (err) {
    log.error({ err }, 'Handler error');
    try {
      await say(`Sorry, something went wrong: ${err.message}`);
    } catch (sayErr) { log.error({ err: sayErr }, 'say() error fallback failed'); }
  }
}

async function sendDm(app, userId, text) {
  const dm = await app.client.conversations.open({ users: userId });
  await app.client.chat.postMessage({ channel: dm.channel.id, text });
}

module.exports = { handle, sendDm };
