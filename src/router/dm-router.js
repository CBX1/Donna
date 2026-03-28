const config = require('../config');
const intentRouter = require('./intent-router');
const userRegistry = require('../core/user-registry');
const permissions = require('../core/permissions');
const conversationStore = require('../stores/conversation-store');
const userStore = require('../stores/user-store');
const prDetector = require('../pr-tracker/tracker');
const { formatAge } = require('../utils/time');

// Handlers
const prReviewHandler = require('../handlers/pr-review');
const remindersHandler = require('../handlers/reminders');
const channelSummaryHandler = require('../handlers/channel-summary');
const tasksHandler = require('../handlers/tasks');
const triageStatusHandler = require('../handlers/triage-status');
const triageRulesHandler = require('../handlers/triage-rules');
const dailySummaryHandler = require('../handlers/daily-summary');
const mentionWatchHandler = require('../handlers/mention-watch');
const onboardingHandler = require('../handlers/onboarding');
const calendarHandler = require('../handlers/calendar');
const conversationEngine = require('../conversation/engine');

// Sassy acknowledgements
const ACKS = [
  "On it...", "Let me check...", "One sec...", "Hang tight...",
  "Looking into it...", "Working on it...", "Lemme see...",
  "Say less...", "Got you...", "Pulling strings...",
  "Donna's on the case...", "Already on it...", "Consider it done...",
];
function getAck() { return ACKS[Math.floor(Math.random() * ACKS.length)]; }

/**
 * Handle a DM message. Called from app.js.
 * @param {object} context - { message, say, app }
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

    // Get/create user + check onboarding
    let displayName = 'Unknown';
    try {
      const info = await app.client.users.info({ user: userId });
      displayName = info.user.real_name || info.user.name || 'Unknown';
    } catch {}

    const { user, isNew } = userRegistry.ensureUser(userId, displayName);

    // Check if user is pasting a Google auth code
    const googleCalendar = require('../integrations/google-calendar');
    if (googleCalendar.hasPendingAuth(userId) && text.match(/^[0-9a-zA-Z/\-_]{20,}$/)) {
      const result = await calendarHandler.handleAuthCode(userId, text);
      await say(result);
      return;
    }

    // Silent PR detection from DMs (awaited so it completes before response)
    console.log(`[DM] Raw text: ${text.substring(0, 200)}`);
    await prDetector.detectFromDm(text, userId, displayName);

    // Get conversation history for context
    const history = conversationStore.getHistory(userId);

    // Classify intent
    const { intent, params } = await intentRouter.classify(text, history);
    console.log(`[${displayName}] Intent: ${intent}`, params);

    let response;

    switch (intent) {
      case 'pr_review':
        response = await prReviewHandler.handle(userId);
        break;

      case 'task_create':
        response = await tasksHandler.handleCreate(userId, params);
        break;

      case 'task_query':
        response = await tasksHandler.handleQuery(userId, params);
        break;

      case 'task_update':
        response = await tasksHandler.handleUpdate(userId, params);
        break;

      case 'reminder_set':
        response = await remindersHandler.handleSet(userId, params, (uid, msg) => sendDm(app, uid, msg));
        break;

      case 'reminder_query':
        response = await remindersHandler.handleQuery(userId);
        break;

      case 'channel_summary':
        response = await channelSummaryHandler.handle(params, app.client);
        break;

      case 'triage_status': {
        const userRec = userStore.getById(userId);
        response = await triageStatusHandler.handle(userId, app.client, userRec?.slack_user_token);
        break;
      }

      case 'triage_rule_add':
        response = await triageRulesHandler.handleAdd(userId, params, app.client);
        break;

      case 'triage_rule_remove':
        response = await triageRulesHandler.handleRemove(userId, params, app.client);
        break;

      case 'triage_rules_list':
        response = triageRulesHandler.handleList(userId);
        break;

      case 'daily_summary':
        response = dailySummaryHandler.generate(userId);
        break;

      case 'calendar_query':
        response = await calendarHandler.handleQuery(userId, params, (uid, msg) => sendDm(app, uid, msg));
        break;

      case 'calendar_create':
        response = await calendarHandler.handleCreate(userId, params, (uid, msg) => sendDm(app, uid, msg));
        break;

      case 'evolve':
        if (!permissions.isAdmin(userId)) {
          response = "Nice try, but only my boss gets to rewire my brain.";
          break;
        }
        const evolveHandler = require('../handlers/evolve');
        response = await evolveHandler.handle(params.instruction, say);
        if (response === null) return;
        break;

      case 'mention_watch_add':
        response = await mentionWatchHandler.handleAdd(userId, params, app.client);
        break;

      case 'mention_watch_remove':
        response = await mentionWatchHandler.handleRemove(userId, params, app.client);
        break;

      case 'mention_watch_list':
        response = mentionWatchHandler.handleList(userId);
        break;

      case 'onboarding':
        response = await onboardingHandler.handle(userId, app.client);
        break;

      case 'general':
        response = await conversationEngine.converse(userId, text);
        break;

      default:
        response = await conversationEngine.converse(userId, text);
    }

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
    } catch {}
  }
}

async function sendDm(app, userId, text) {
  const dm = await app.client.conversations.open({ users: userId });
  await app.client.chat.postMessage({ channel: dm.channel.id, text });
}

module.exports = { handle, sendDm };
