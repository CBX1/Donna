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
    description: 'Get a summary of recent messages in a Slack channel',
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
    description: 'Show what messages Donna triaged recently — how many were cleared as noise, which ones need the user\'s attention. Use this when the user asks "what did you triage", "any alerts", "what needs my attention", "triage report", "what did you handle".',
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
    description: 'Add a PERMANENT triage rule — auto-mark an entire channel as read forever, or permanently ignore a text pattern. Only use when user EXPLICITLY asks to auto-read a channel or ignore a pattern. Do NOT use when user says they already read something or dismisses a single item.',
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
    description: 'List the user\'s triage configuration — which channels are set to auto-read and which text patterns are being ignored. Use when user asks "what are my triage rules", "what channels do you auto-read", "show my triage config".',
    parameters: { type: 'object', properties: {} },
    handler: async (userId) => {
      const handler = require('../handlers/triage-rules');
      return handler.handleList(userId);
    },
  },

  {
    name: 'dismiss_attention',
    description: 'Dismiss/acknowledge attention items for a channel — mark them as read/handled. Use when user says "I\'ve read it", "already saw that", "dismiss it", "clear that channel", or acknowledges they\'ve seen the attention items.',
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
