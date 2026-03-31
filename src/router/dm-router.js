const config = require('../config');
const log = require('../utils/logger').child({ module: 'dm' });
const userRegistry = require('../core/user-registry');
const conversationStore = require('../stores/conversation-store');
const prDetector = require('../pr-tracker/tracker');
const conversationEngine = require('../conversation/engine');
const health = require('../core/health');
const metrics = require('../core/metrics');

/**
 * Handle a DM message. Called from app.js.
 * Uses unified conversational engine with Gemini function calling.
 */
async function handle({ message, say, app }) {
  if (message.subtype === 'bot_message' || message.bot_id) return;
  if (message.channel_type !== 'im') return;

  const text = message.text || '';
  const userId = message.user;

  try {
    if (!config.gemini.apiKey) {
      await say("Hey! I'm Donna. I'm almost ready — just need my AI brain connected. Hang tight!");
      return;
    }

    // Get/create user
    let displayName = 'Unknown';
    try {
      const info = await app.client.users.info({ user: userId });
      displayName = info.user.real_name || info.user.name || 'Unknown';
    } catch (err) { log.error({ err }, 'users.info failed'); }

    const { user, isNew } = userRegistry.ensureUser(userId, displayName);

    // Check if user is pasting a Google auth code
    const googleCalendar = require('../integrations/google-calendar');
    if (googleCalendar.hasPendingAuth(userId) && text.match(/^[0-9a-zA-Z/\-_]{20,}$/)) {
      const calendarHandler = require('../handlers/calendar');
      const result = await calendarHandler.handleAuthCode(userId, text);
      await say(result);
      return;
    }

    health.recordMessage();
    metrics.increment('messagesHandled');

    // PR detection from DMs
    log.info({ text: text.substring(0, 200) }, 'Raw text');
    const prDetected = await prDetector.detectFromDm(text, userId, displayName);

    // Context for tool handlers
    const ctx = {
      app,
      say,
      slackClient: app.client,
      sendDm: (uid, msg) => sendDm(app, uid, msg),
    };

    // Add PR detection context so Gemini can acknowledge it
    let enrichedText = text;
    if (prDetected) {
      enrichedText += `\n\n[SYSTEM: A PR was auto-detected and tracked: "${prDetected.title}" by ${prDetected.author} (${prDetected.isNew ? 'newly added' : 'already tracked'})]`;
    }

    // Unified conversation — Gemini decides what to do (respond, call tools, or both)
    const { text: response, toolsCalled } = await conversationEngine.converse(userId, enrichedText, ctx);

    // Track conversation history — include tool context so Gemini remembers what it did
    if (userId && text) {
      conversationStore.addMessage(userId, 'user', text);
      if (response) {
        const modelMsg = toolsCalled.length > 0
          ? `${toolsCalled.join('\n')}\n\n${response}`
          : response;
        conversationStore.addMessage(userId, 'model', modelMsg);
      }
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
