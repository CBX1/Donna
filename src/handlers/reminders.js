const reminderStore = require('../stores/reminder-store');
const { parseTime } = require('../utils/time');

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function handleSet(userId, params, sendDm) {
  const triggerAt = parseTime(params.time);
  if (!triggerAt) {
    return `I don't speak that time format. Try "at 4pm", "in 2 hours", or "tomorrow at 10am".`;
  }

  reminderStore.add(params.text, triggerAt, userId, (r) => {
    const msgs = [
      `*Hey — you asked me to remind you:* ${r.text}`,
      `*Ping!* You wanted to remember this: ${r.text}`,
      `*Donna here.* You told me to nudge you about: ${r.text}`,
      `*Don't forget:* ${r.text} — you're welcome.`,
    ];
    sendDm(r.userId, pick(msgs)).catch(err => console.error('Reminder DM failed:', err));
  });

  const timeStr = triggerAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const replies = [
    `I'll ping you about "${params.text}" at ${timeStr}. I never forget.`,
    `"${params.text}" at ${timeStr} — locked in. I'm basically your brain's backup.`,
    `Set. I'll nudge you at ${timeStr} about "${params.text}".`,
  ];
  return pick(replies);
}

async function handleQuery(userId) {
  const pending = reminderStore.getPending(userId);
  if (pending.length === 0) return "No pending reminders. Your future self is on their own for now.";

  const lines = pending.map(r => {
    const timeStr = r.triggerAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    return `• ${r.text} — ${timeStr}`;
  });
  return `*${pending.length} reminder${pending.length > 1 ? 's' : ''} queued up:*\n${lines.join('\n')}`;
}

module.exports = { handleSet, handleQuery };
