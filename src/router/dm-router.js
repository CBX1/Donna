const config = require('../config');
const userRegistry = require('../core/user-registry');
const conversationStore = require('../stores/conversation-store');
const prDetector = require('../pr-tracker/tracker');
const conversationEngine = require('../conversation/engine');

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
    } catch (err) { console.error('[DM] users.info failed:', err.message); }

    const { user, isNew } = userRegistry.ensureUser(userId, displayName);

    // Check if user is pasting a Google auth code
    const googleCalendar = require('../integrations/google-calendar');
    if (googleCalendar.hasPendingAuth(userId) && text.match(/^[0-9a-zA-Z/\-_]{20,}$/)) {
      const calendarHandler = require('../handlers/calendar');
      const result = await calendarHandler.handleAuthCode(userId, text);
      await say(result);
      return;
    }

    // Silent PR detection from DMs
    console.log(`[DM] Raw text: ${text.substring(0, 200)}`);
    await prDetector.detectFromDm(text, userId, displayName);

    // Context for tool handlers
    const ctx = {
      app,
      say,
      slackClient: app.client,
      sendDm: (uid, msg) => sendDm(app, uid, msg),
    };

    // Unified conversation — Gemini decides what to do (respond, call tools, or both)
    const response = await conversationEngine.converse(userId, text, ctx);

    // Track conversation history
    if (userId && text) {
      conversationStore.addMessage(userId, 'user', text);
      if (response) conversationStore.addMessage(userId, 'model', response);
    }

    if (response) await say(response);
  } catch (err) {
    console.error('Handler error:', err.message);
    try {
      await say(`Sorry, something went wrong: ${err.message}`);
    } catch (sayErr) { console.error('[DM] say() error fallback failed:', sayErr.message); }
  }
}

async function sendDm(app, userId, text) {
  const dm = await app.client.conversations.open({ users: userId });
  await app.client.chat.postMessage({ channel: dm.channel.id, text });
}

module.exports = { handle, sendDm };
