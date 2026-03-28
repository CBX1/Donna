const db = require('../db');

const insertStmt = db.prepare(
  'INSERT INTO reminders (text, trigger_at, user_id, status) VALUES (?, ?, ?, ?)'
);
const getPendingStmt = db.prepare(
  "SELECT * FROM reminders WHERE status = 'pending' AND user_id = ? ORDER BY trigger_at"
);
const getPendingAllStmt = db.prepare(
  "SELECT * FROM reminders WHERE status = 'pending' ORDER BY trigger_at"
);
const updateStatusStmt = db.prepare('UPDATE reminders SET status = ? WHERE id = ?');

const timers = {};

function add(text, triggerAt, userId, onTrigger) {
  const result = insertStmt.run(text, triggerAt.toISOString(), userId, 'pending');
  const reminder = { id: result.lastInsertRowid, text, triggerAt, userId, status: 'pending' };
  scheduleTimer(reminder, onTrigger);
  return reminder;
}

function scheduleTimer(reminder, onTrigger) {
  const delay = new Date(reminder.triggerAt).getTime() - Date.now();
  if (delay <= 0) {
    updateStatusStmt.run('triggered', reminder.id);
    if (onTrigger) onTrigger(reminder);
  } else {
    timers[reminder.id] = setTimeout(() => {
      updateStatusStmt.run('triggered', reminder.id);
      if (onTrigger) onTrigger(reminder);
      delete timers[reminder.id];
    }, delay);
  }
}

function restorePending(onTrigger) {
  const pending = getPendingAllStmt.all();
  let restored = 0, triggered = 0;
  for (const row of pending) {
    const reminder = { id: row.id, text: row.text, triggerAt: new Date(row.trigger_at), userId: row.user_id };
    if (reminder.triggerAt.getTime() <= Date.now()) {
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
  return getPendingStmt.all(userId).map(r => ({
    id: r.id, text: r.text, triggerAt: new Date(r.trigger_at), userId: r.user_id,
  }));
}

function cancel(id) {
  if (timers[id]) { clearTimeout(timers[id]); delete timers[id]; }
  updateStatusStmt.run('cancelled', id);
}

module.exports = { add, getPending, cancel, restorePending };
