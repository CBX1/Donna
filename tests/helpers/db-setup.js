// IMPORTANT: Set the in-memory DB path BEFORE requiring db or any store modules.
// This module must be imported at the very top of each test file.
process.env.DONNA_DB_PATH = ':memory:';

const db = require('../../src/db');

/**
 * Deletes all rows from every application table, keeping the schema intact.
 * Call this in `beforeEach` to ensure a clean slate between tests.
 */
function resetDb() {
  db.exec(`
    DELETE FROM conversation_history;
    DELETE FROM triage_log;
    DELETE FROM triage_rules;
    DELETE FROM pr_tracking;
    DELETE FROM user_triage_channels;
    DELETE FROM mention_watch;
    DELETE FROM last_queried;
    DELETE FROM triage_last_processed_v2;
    DELETE FROM triage_last_processed;
    DELETE FROM reminders;
    DELETE FROM users;
  `);
}

module.exports = { resetDb, db };
