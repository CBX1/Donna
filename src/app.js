const { App } = require('@slack/bolt');
const { WebClient } = require('@slack/web-api');
const config = require('./config');
const log = require('./utils/logger').child({ module: 'startup' });

// Initialize DB (runs migrations)
require('./db');

// Initialize Bolt app
const app = new App({
  token: config.slack.botToken,
  appToken: config.slack.appToken,
  socketMode: true,
});

// Routers
const dmRouter = require('./router/dm-router');

// Schedulers
const triageScheduler = require('./triage/scheduler');
const dailySummaryHandler = require('./handlers/daily-summary');
const reminderStore = require('./stores/reminder-store');
const userStore = require('./stores/user-store');
const userRegistry = require('./core/user-registry');
const conversationStore = require('./stores/conversation-store');
const triageLogStore = require('./stores/triage-log-store');
const notion = require('./integrations/notion');

// Helper: send DM
async function sendDm(userId, text) {
  const dm = await app.client.conversations.open({ users: userId });
  await app.client.chat.postMessage({ channel: dm.channel.id, text });
}

// DM handler
app.message(async ({ message, say }) => {
  await dmRouter.handle({ message, say, app });
});

// @Donna mentions
app.event('app_mention', async ({ event, say }) => {
  if (!event.user) return;
  const text = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
  if (!text) return;
  try {
    const conversationEngine = require('./conversation/engine');
    const ctx = { slackClient: app.client, say, sendDm: (uid, msg) => sendDm(uid, msg) };
    const { text: response } = await conversationEngine.converse(event.user, text, ctx);
    if (response) await say({ text: response, thread_ts: event.ts });
  } catch (err) {
    log.error({ err }, 'Mention handler error');
  }
});

// Startup
(async () => {
  await app.start();
  log.info('Donna is running');

  // Self-test integrations
  const selfTest = require('./core/self-test');
  const health = require('./core/health');
  try {
    const { results } = await selfTest.run(app);
    health.setIntegrations(results);
  } catch (err) {
    log.error({ err }, 'Critical self-test failed — exiting');
    process.exit(1);
  }

  // Health check endpoint
  const HEALTH_PORT = parseInt(process.env.HEALTH_PORT) || 3001;
  health.start(HEALTH_PORT);

  // Build email directory from Slack workspace
  const emailDirectory = require('./core/email-directory');
  try {
    await emailDirectory.buildDirectory(app.client);
  } catch (err) {
    log.error({ err }, 'Email directory build failed');
  }

  // Restore reminders
  reminderStore.restorePending((reminder) => {
    const msgs = [
      `*Hey — you asked me to remind you:* ${reminder.text}`,
      `*Donna here.* You told me to nudge you about: ${reminder.text}`,
    ];
    const msg = msgs[Math.floor(Math.random() * msgs.length)];
    sendDm(reminder.userId, msg).catch(err => log.error({ err }, 'Reminder DM failed'));
  });

  // Prune old data
  conversationStore.pruneOlderThan(12);
  triageLogStore.pruneOlderThan(7);

  // Seed admin user if not exists
  const adminId = config.summary.userId;
  if (adminId) {
    const admin = userStore.getOrCreate(adminId, 'Admin', 1);
    if (!admin.onboarding_complete) {
      userStore.update(adminId, {
        onboarding_complete: 1,
        is_admin: 1,
        github_username: config.github.username,
        notion_database_id: config.notion.tasksDatabaseId,
        slack_user_token: config.slack.userToken,
        daily_summary_time: '19:30',
      });
      log.info('Admin user seeded');
    }

    // Migrate admin's triage channels from env
    const existingChannels = userRegistry.getTriageChannels(adminId);
    if (existingChannels.length === 0 && config.triage.channels.length > 0) {
      const channels = [];
      for (const chId of config.triage.channels) {
        try {
          await app.client.conversations.join({ channel: chId });
          const info = await app.client.conversations.info({ channel: chId });
          channels.push({ id: chId, name: info.channel?.name || chId });
        } catch {
          channels.push({ id: chId, name: chId });
        }
      }
      userRegistry.setTriageChannels(adminId, channels);
      log.info({ count: channels.length }, 'Migrated triage channels for admin');
    }

    // Ensure Notion columns
    if (config.notion.tasksDatabaseId) {
      await notion.ensureColumns(config.notion.tasksDatabaseId);
      log.info('Notion DB configured');
    }
  }

  // Start triage scheduler (multi-user)
  const userClient = config.slack.userToken ? new WebClient(config.slack.userToken) : null;
  triageScheduler.start(app.client, userClient, { sendDm });


  // Start daily summary
  dailySummaryHandler.start(sendDm);

  log.info('All systems go');
})();
