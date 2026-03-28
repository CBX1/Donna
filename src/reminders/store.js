const db = require('../db');

// Prepared statements
const insertStmt = db.prepare(
  'INSERT INTO reminders (text, trigger_at, user_id, status) VALUES (?, ?, ?, ?)'
);
const getPendingStmt = db.prepare(
  "SELECT * FROM reminders WHERE status = 'pending' AND (user_id = ? OR ? IS NULL) ORDER BY trigger_at"
);
const getAllStmt = db.prepare(
  'SELECT * FROM reminders WHERE user_id = ? OR ? IS NULL ORDER BY trigger_at DESC'
);
const updateStatusStmt = db.prepare(
  'UPDATE reminders SET status = ? WHERE id = ?'
);

// Active timers (keyed by reminder id)
const timers = {};

/**
 * Add a new reminder and schedule it.
 * @param {string} text - What to remind about
 * @param {Date} triggerAt - When to trigger
 * @param {string} userId - Slack user ID
 * @param {Function} onTrigger - Callback: (reminder) => {}
 * @returns {object} The created reminder
 */
function add(text, triggerAt, userId, onTrigger) {
  const result = insertStmt.run(text, triggerAt.toISOString(), userId, 'pending');
  const reminder = {
    id: result.lastInsertRowid,
    text,
    triggerAt,
    userId,
    status: 'pending',
  };

  scheduleTimer(reminder, onTrigger);
  return reminder;
}

/**
 * Schedule a timer for a reminder.
 */
function scheduleTimer(reminder, onTrigger) {
  const delay = new Date(reminder.triggerAt).getTime() - Date.now();

  if (delay <= 0) {
    // Trigger immediately
    updateStatusStmt.run('triggered', reminder.id);
    reminder.status = 'triggered';
    if (onTrigger) onTrigger(reminder);
  } else {
    timers[reminder.id] = setTimeout(() => {
      updateStatusStmt.run('triggered', reminder.id);
      reminder.status = 'triggered';
      if (onTrigger) onTrigger(reminder);
      delete timers[reminder.id];
    }, delay);
  }
}

/**
 * Restore pending reminders from DB on startup.
 * Call this once after the bot starts.
 * @param {Function} onTrigger - Callback for when reminder fires
 */
function restorePending(onTrigger) {
  const pending = getPendingStmt.all(null, null);
  let restored = 0;
  let triggered = 0;

  for (const row of pending) {
    const reminder = {
      id: row.id,
      text: row.text,
      triggerAt: new Date(row.trigger_at),
      userId: row.user_id,
      status: row.status,
    };

    const delay = reminder.triggerAt.getTime() - Date.now();
    if (delay <= 0) {
      // Past due — trigger immediately
      updateStatusStmt.run('triggered', reminder.id);
      if (onTrigger) onTrigger(reminder);
      triggered++;
    } else {
      scheduleTimer(reminder, onTrigger);
      restored++;
    }
  }

  if (restored > 0 || triggered > 0) {
    console.log(`⏰ Reminders: ${restored} restored, ${triggered} triggered (past due)`);
  }
}

function getPending(userId) {
  return getPendingStmt.all(userId || null, userId || null).map(row => ({
    id: row.id,
    text: row.text,
    triggerAt: new Date(row.trigger_at),
    userId: row.user_id,
    status: row.status,
  }));
}

function getAll(userId) {
  return getAllStmt.all(userId || null, userId || null).map(row => ({
    id: row.id,
    text: row.text,
    triggerAt: new Date(row.trigger_at),
    userId: row.user_id,
    status: row.status,
  }));
}

function cancel(id) {
  if (timers[id]) {
    clearTimeout(timers[id]);
    delete timers[id];
  }
  updateStatusStmt.run('cancelled', id);
  return true;
}

module.exports = { add, getPending, getAll, cancel, restorePending };
