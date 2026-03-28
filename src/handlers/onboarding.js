const userStore = require('../stores/user-store');
const log = require('../utils/logger').child({ module: 'onboarding' });
const userRegistry = require('../core/user-registry');

async function handle(userId, slackClient) {
  const user = userStore.getById(userId);

  if (user?.onboarding_complete) {
    return `You're already set up! Here's what I can do for you:\n\n${getCapabilitiesSummary()}\n\n_Just DM me anytime._`;
  }

  // Mark as onboarding in progress (create user if needed)
  if (!user) {
    let displayName = 'there';
    try {
      const info = await slackClient.users.info({ user: userId });
      displayName = info.user.real_name || info.user.name || 'there';
    } catch (err) { log.error({ err }, 'users.info failed'); }
    userRegistry.ensureUser(userId, displayName);
  }

  return `Hey! I'm *Donna* — your AI assistant, right here in Slack. Think of me as the person who knows everything and never forgets. 😏

Here's what I can do for you:

*🔔 Alert Triage*
I monitor your Slack alert channels, mark noise as read, and only surface what matters. You tell me which channels to watch.

*🔀 PR Tracking*
I track PRs assigned to you for review (via GitHub). Forward me any PR link and I'll track it. Ask "what PRs need my review?" anytime.

*📋 Task Management*
I manage your tasks in a Notion database. Create, query, and update tasks — all from this chat.

*⏰ Reminders*
"Remind me to check deploy logs at 4pm" — I'll DM you when it's time. Survives restarts.

*📊 Daily Summary*
Every evening, I'll send you a wrap-up: what I triaged, what needs your attention, pending PRs.

*💬 Channel Summaries*
"Catch me up on #engineering" — I'll summarize recent messages in any channel.

*📅 Google Calendar* _(coming soon)_
View your schedule and create meetings from chat.

*👀 Mention Watch*
"Watch #backend for my name" — I'll DM you whenever you're mentioned.

To get started, I need a few things:
1. Your *GitHub username* (for PR tracking) — just tell me, e.g. "my GitHub is johndoe"
2. Which *Slack channels* to triage for you
3. A *Notion database* link (or I can create one for you)

_Tell me your GitHub username to begin, or ask me anything!_`;
}

function getCapabilitiesSummary() {
  return `• *Alert triage* — monitoring your channels, marking noise as read
• *PR tracking* — GitHub review requests + DM forwarded PRs
• *Tasks* — Notion-backed task management
• *Reminders* — scheduled DMs
• *Daily summary* — EOD wrap-up
• *Channel summaries* — summarize any channel
• *Mention watch* — DM when you're mentioned in specific channels`;
}

module.exports = { handle, getCapabilitiesSummary };
