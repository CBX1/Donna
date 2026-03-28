-- Track whether attention items have been acknowledged/dismissed.
-- Attention items persist across restarts until the user reads the channel.
ALTER TABLE triage_log ADD COLUMN dismissed INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_triage_log_attention ON triage_log(user_id, classification, dismissed);
