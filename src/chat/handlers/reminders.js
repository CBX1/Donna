const store = require('../../reminders/store');

/**
 * Parse a time string into a Date object.
 * Handles: "in 2 hours", "tomorrow at 10am", ISO strings, "4:15pm", etc.
 */
function parseTime(timeStr) {
  // Try ISO 8601 first
  const isoDate = new Date(timeStr);
  if (!isNaN(isoDate.getTime()) && timeStr.includes('-')) return isoDate;

  const now = new Date();
  const lower = timeStr.toLowerCase().trim();

  // "in X hours/minutes"
  const inMatch = lower.match(/in\s+(\d+)\s+(hour|minute|min|hr)s?/);
  if (inMatch) {
    const amount = parseInt(inMatch[1]);
    const unit = inMatch[2].startsWith('hour') || inMatch[2].startsWith('hr') ? 'hours' : 'minutes';
    const ms = unit === 'hours' ? amount * 60 * 60 * 1000 : amount * 60 * 1000;
    return new Date(now.getTime() + ms);
  }

  // "tomorrow at Xam/pm"
  const tomorrowMatch = lower.match(/tomorrow\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (tomorrowMatch) {
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    let hours = parseInt(tomorrowMatch[1]);
    const minutes = tomorrowMatch[2] ? parseInt(tomorrowMatch[2]) : 0;
    const ampm = tomorrowMatch[3];
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  // "at X:XXam/pm" or "X:XX am/pm" or "Xpm"
  const timeMatch = lower.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (timeMatch) {
    const date = new Date(now);
    let hours = parseInt(timeMatch[1]);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const ampm = timeMatch[3];
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
    date.setHours(hours, minutes, 0, 0);
    // If the time has already passed today, set for tomorrow
    if (date <= now) date.setDate(date.getDate() + 1);
    return date;
  }

  // Fallback: try native parsing
  const fallback = new Date(timeStr);
  if (!isNaN(fallback.getTime())) return fallback;

  return null;
}

/**
 * Set a reminder. Returns response text.
 * @param {object} params - { text, time }
 * @param {string} userId - Slack user ID
 * @param {Function} sendDm - Function to send a DM: (userId, text) => Promise
 */
async function handleSet(params, userId, sendDm) {
  const triggerAt = parseTime(params.time);

  if (!triggerAt) {
    return `I don't speak that time format. Try something like "at 4pm", "in 2 hours", or "tomorrow at 10am".`;
  }

  const REMINDER_MSGS = [
    `*Hey — you asked me to remind you:* ${r => r.text}`,
    `*Ping!* You wanted to remember this: ${r => r.text}`,
    `*Donna here.* You told me to nudge you about: ${r => r.text}`,
    `*Don't forget:* ${r => r.text} — you're welcome.`,
  ];

  const reminder = store.add(params.text, triggerAt, userId, (r) => {
    const msgs = [
      `*Hey — you asked me to remind you:* ${r.text}`,
      `*Ping!* You wanted to remember this: ${r.text}`,
      `*Donna here.* You told me to nudge you about: ${r.text}`,
      `*Don't forget:* ${r.text} — you're welcome.`,
    ];
    const msg = msgs[Math.floor(Math.random() * msgs.length)];
    sendDm(r.userId, msg).catch(err => console.error('Failed to send reminder:', err));
  });

  const timeStr = triggerAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const SET_REPLIES = [
    `I'll ping you about "${params.text}" at ${timeStr}. I never forget.`,
    `Noted. "${params.text}" — ${timeStr}. Consider it handled.`,
    `Set. I'll nudge you at ${timeStr} about "${params.text}".`,
    `"${params.text}" at ${timeStr} — locked in. I'm basically your brain's backup.`,
  ];
  return SET_REPLIES[Math.floor(Math.random() * SET_REPLIES.length)];
}

async function handleQuery(userId) {
  const pending = store.getPending(userId);
  if (pending.length === 0) return "No pending reminders. Your future self is on their own for now.";

  const lines = pending.map(r => {
    const timeStr = r.triggerAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    return `• ${r.text} — ${timeStr}`;
  });

  return `*${pending.length} reminder${pending.length > 1 ? 's' : ''} queued up:*\n${lines.join('\n')}`;
}

module.exports = { handleSet, handleQuery };
