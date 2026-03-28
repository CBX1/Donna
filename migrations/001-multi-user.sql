-- Donna v2: Multi-user schema

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  slack_user_token TEXT,
  google_refresh_token TEXT,
  google_access_token TEXT,
  google_token_expiry TEXT,
  github_username TEXT,
  notion_database_id TEXT,
  timezone TEXT DEFAULT 'Asia/Kolkata',
  is_admin INTEGER DEFAULT 0,
  onboarding_complete INTEGER DEFAULT 0,
  daily_summary_time TEXT DEFAULT '19:30',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_triage_channels (
  user_id TEXT NOT NULL REFERENCES users(id),
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE IF NOT EXISTS triage_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  rule_type TEXT NOT NULL,
  channel_name TEXT,
  pattern TEXT,
  default_action TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mention_watch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  patterns TEXT NOT NULL,
  UNIQUE(user_id, channel_id)
);

CREATE TABLE IF NOT EXISTS triage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  classification TEXT NOT NULL,
  reason TEXT,
  message_text TEXT,
  message_ts TEXT,
  logged_at TEXT DEFAULT (datetime('now')),
  log_date TEXT
);
CREATE INDEX IF NOT EXISTS idx_triage_log_user_date ON triage_log(user_id, log_date);

CREATE TABLE IF NOT EXISTS pr_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  pr_url TEXT NOT NULL,
  title TEXT,
  author TEXT,
  status TEXT DEFAULT 'pending',
  gh_state TEXT,
  gh_review_status TEXT,
  detected_from TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, pr_url)
);

CREATE TABLE IF NOT EXISTS triage_last_processed_v2 (
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  last_ts TEXT NOT NULL,
  PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE IF NOT EXISTS conversation_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_convo_user ON conversation_history(user_id, created_at);

-- Ensure indexes on existing tables
CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id, status);
