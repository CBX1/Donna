/**
 * Tool definitions for Gemini function calling.
 * Single source of truth for all Donna capabilities.
 *
 * Each tool defines:
 * - name: Function name for Gemini
 * - description: What it does (Gemini uses this to decide when to call)
 * - parameters: JSON Schema for function args
 * - handler: async (userId, params, ctx) => string
 * - adminOnly: (optional) restrict to admin users
 */

const tools = [
  {
    name: 'get_pending_prs',
    description: 'Get PRs that need the user\'s review, check PR status, or list open pull requests assigned to them',
    parameters: { type: 'object', properties: {} },
    handler: async (userId) => {
      const handler = require('../handlers/pr-review');
      return handler.handle(userId);
    },
  },

  {
    name: 'track_pr',
    description: 'Add a PR to the user\'s review tracking list. Use when the user shares a GitHub PR URL and wants it tracked, or asks to add/track/watch a PR.',
    parameters: {
      type: 'object',
      properties: {
        pr_url: { type: 'string', description: 'GitHub PR URL (e.g. https://github.com/org/repo/pull/123)' },
      },
      required: ['pr_url'],
    },
    handler: async (userId, params) => {
      const github = require('../integrations/github');
      const notion = require('../integrations/notion');
      const userStore = require('../stores/user-store');

      // Clean URL — strip Slack formatting
      let prUrl = params.pr_url.replace(/<([^|>]+)(\|[^>]*)?>/, '$1');
      prUrl = prUrl.replace(/\/(files|changes|commits|checks).*$/, '');

      const details = await github.getPrDetails(prUrl);
      if (!details) return `Couldn't fetch PR details for ${prUrl}. Is the URL correct?`;

      if (details.state === 'closed' || details.merged) {
        return `That PR is already ${details.merged ? 'merged' : 'closed'}: *${details.title}*`;
      }

      const user = userStore.getById(userId);
      if (!user?.notion_database_id) {
        return "I don't have a Notion database set up for you yet. Tell me to set up or share a Notion database link.";
      }

      await notion.createPrReview(user.notion_database_id, {
        prUrl, context: details.title, assignee: details.author,
      });

      return `Tracked: *${details.title}* by ${details.author} (${details.isDraft ? 'draft' : 'open'})`;
    },
  },

  {
    name: 'create_task',
    description: 'Create a new task or todo item for the user',
    parameters: {
      type: 'object',
      properties: { title: { type: 'string', description: 'Task title' } },
      required: ['title'],
    },
    handler: async (userId, params) => {
      const handler = require('../handlers/tasks');
      return handler.handleCreate(userId, params);
    },
  },

  {
    name: 'query_tasks',
    description: 'List the user\'s tasks, open tasks, done tasks, or full todo list',
    parameters: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['open', 'done', 'all'], description: 'Filter by status' } },
    },
    handler: async (userId, params) => {
      const handler = require('../handlers/tasks');
      return handler.handleQuery(userId, params);
    },
  },

  {
    name: 'update_task',
    description: 'Mark a task as done or update its status',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text to find the task' },
        status: { type: 'string', enum: ['done', 'open'], description: 'New status' },
      },
      required: ['query', 'status'],
    },
    handler: async (userId, params) => {
      const handler = require('../handlers/tasks');
      return handler.handleUpdate(userId, params);
    },
  },

  {
    name: 'set_reminder',
    description: 'Set a reminder for the user at a specific time',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What to remind about' },
        time: { type: 'string', description: 'When to remind (e.g. "in 2 hours", "tomorrow at 10am", "at 4pm")' },
      },
      required: ['text', 'time'],
    },
    handler: async (userId, params, ctx) => {
      const handler = require('../handlers/reminders');
      return handler.handleSet(userId, params, ctx.sendDm);
    },
  },

  {
    name: 'query_reminders',
    description: 'List the user\'s pending reminders',
    parameters: { type: 'object', properties: {} },
    handler: async (userId) => {
      const handler = require('../handlers/reminders');
      return handler.handleQuery(userId);
    },
  },

  {
    name: 'summarize_channel',
    description: 'Summarize messages from a specific named Slack channel',
    parameters: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel name (without #)' },
        timeframe: { type: 'string', description: 'Time range like "today", "last 3 hours", "yesterday"' },
      },
      required: ['channel'],
    },
    handler: async (_userId, params, ctx) => {
      const handler = require('../handlers/channel-summary');
      return handler.handle(params, ctx.slackClient);
    },
  },

  {
    name: 'get_triage_status',
    description: 'Show what messages Donna triaged recently — how many were cleared as noise, and which ones still need the user\'s attention. Returns a summary of triaged messages, not configuration.',
    parameters: { type: 'object', properties: {} },
    handler: async (userId, _params, ctx) => {
      const userStore = require('../stores/user-store');
      const user = userStore.getById(userId);
      const handler = require('../handlers/triage-status');
      return handler.handle(userId, ctx.slackClient, user?.slack_user_token);
    },
  },

  {
    name: 'add_triage_rule',
    description: 'Add a permanent triage rule — auto-mark an entire channel as read, or permanently ignore a text pattern. This is a configuration change that affects all future messages.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['channel', 'pattern'], description: 'Rule type' },
        value: { type: 'string', description: 'Channel name or text pattern to ignore' },
      },
      required: ['type', 'value'],
    },
    handler: async (userId, params, ctx) => {
      const handler = require('../handlers/triage-rules');
      return handler.handleAdd(userId, params, ctx.slackClient);
    },
  },

  {
    name: 'remove_triage_rule',
    description: 'Remove a triage rule — stop auto-reading a channel or ignoring a pattern',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['channel', 'pattern'], description: 'Rule type' },
        value: { type: 'string', description: 'Channel name or text pattern' },
      },
      required: ['type', 'value'],
    },
    handler: async (userId, params, ctx) => {
      const handler = require('../handlers/triage-rules');
      return handler.handleRemove(userId, params, ctx.slackClient);
    },
  },

  {
    name: 'list_triage_rules',
    description: 'List the user\'s triage configuration and how Donna is set up for them — which channels are set to auto-read, which text patterns are being ignored, and what channels are being monitored.',
    parameters: { type: 'object', properties: {} },
    handler: async (userId) => {
      const handler = require('../handlers/triage-rules');
      return handler.handleList(userId);
    },
  },

  {
    name: 'dismiss_attention',
    description: 'Dismiss attention items for a specific channel — mark them as handled so they stop appearing. This is a one-time acknowledgement, not a permanent rule.',
    parameters: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel name to dismiss attention items for' },
      },
      required: ['channel'],
    },
    handler: async (userId, params) => {
      const db = require('../db');
      const channelName = params.channel.replace('#', '').toLowerCase();
      const result = db.prepare(
        "UPDATE triage_log SET dismissed = 1 WHERE user_id = ? AND classification = 'attention' AND dismissed = 0 AND channel_name = ?"
      ).run(userId, channelName);
      if (result.changes > 0) {
        return `Dismissed ${result.changes} attention item(s) from #${channelName}.`;
      }
      return `No pending attention items found for #${channelName}.`;
    },
  },

  {
    name: 'get_daily_summary',
    description: 'Generate the daily end-of-day summary report',
    parameters: { type: 'object', properties: {} },
    handler: async (userId) => {
      const handler = require('../handlers/daily-summary');
      return handler.generate(userId);
    },
  },

  {
    name: 'query_calendar',
    description: 'Check the user\'s calendar, meetings, or schedule for a given day',
    parameters: {
      type: 'object',
      properties: { date: { type: 'string', description: 'Date like "today", "tomorrow", or "2026-03-28"' } },
    },
    handler: async (userId, params, ctx) => {
      const handler = require('../handlers/calendar');
      return handler.handleQuery(userId, params, ctx.sendDm);
    },
  },

  {
    name: 'create_calendar_event',
    description: 'Schedule a new meeting or calendar event',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Meeting title' },
        date: { type: 'string', description: 'Date' },
        time: { type: 'string', description: 'Start time' },
        duration_minutes: { type: 'number', description: 'Duration in minutes' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee names or emails' },
      },
      required: ['title', 'date', 'time'],
    },
    handler: async (userId, params, ctx) => {
      const handler = require('../handlers/calendar');
      return handler.handleCreate(userId, params, ctx.sendDm);
    },
  },

  {
    name: 'add_mention_watch',
    description: 'Start watching a channel for mentions of the user or specific keywords',
    parameters: {
      type: 'object',
      properties: { channel: { type: 'string', description: 'Channel name to watch' } },
      required: ['channel'],
    },
    handler: async (userId, params, ctx) => {
      const handler = require('../handlers/mention-watch');
      return handler.handleAdd(userId, params, ctx.slackClient);
    },
  },

  {
    name: 'remove_mention_watch',
    description: 'Stop watching a channel for mentions',
    parameters: {
      type: 'object',
      properties: { channel: { type: 'string', description: 'Channel name to stop watching' } },
      required: ['channel'],
    },
    handler: async (userId, params, ctx) => {
      const handler = require('../handlers/mention-watch');
      return handler.handleRemove(userId, params, ctx.slackClient);
    },
  },

  {
    name: 'list_mention_watches',
    description: 'List all channels being watched for mentions',
    parameters: { type: 'object', properties: {} },
    handler: async (userId) => {
      const handler = require('../handlers/mention-watch');
      return handler.handleList(userId);
    },
  },

  {
    name: 'start_onboarding',
    description: 'Set up Donna for the user — configure settings, get started guide',
    parameters: { type: 'object', properties: {} },
    handler: async (userId, _params, ctx) => {
      const handler = require('../handlers/onboarding');
      return handler.handle(userId, ctx.slackClient);
    },
  },

  {
    name: 'submit_google_auth_code',
    description: 'Submit a Google OAuth authorization code to complete calendar setup. Use when the user pastes an auth code during Google Calendar setup.',
    parameters: {
      type: 'object',
      properties: { code: { type: 'string', description: 'The authorization code pasted by the user' } },
      required: ['code'],
    },
    handler: async (userId, params) => {
      const handler = require('../handlers/calendar');
      return handler.handleAuthCode(userId, params.code);
    },
  },

  {
    name: 'evolve_donna',
    description: 'Modify Donna\'s own code — add features, fix behavior, improve capabilities. Admin only.',
    parameters: {
      type: 'object',
      properties: { instruction: { type: 'string', description: 'What to change about Donna' } },
      required: ['instruction'],
    },
    adminOnly: true,
    handler: async (userId, params, ctx) => {
      const handler = require('../handlers/evolve');
      return handler.handle(params.instruction, ctx.say);
    },
  },
];

/**
 * Get Gemini function declarations (tool definitions without handlers).
 */
function getGeminiFunctionDeclarations() {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

/**
 * Find a tool by name.
 */
function getTool(name) {
  return tools.find(t => t.name === name);
}

module.exports = { tools, getGeminiFunctionDeclarations, getTool };
