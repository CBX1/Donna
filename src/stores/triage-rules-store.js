const db = require('../db');

function getRulesForUser(userId) {
  return db.prepare('SELECT * FROM triage_rules WHERE user_id = ?').all(userId);
}

function addAutoReadChannel(userId, channelName) {
  const name = channelName.replace('#', '').toLowerCase();
  const existing = db.prepare(
    "SELECT id FROM triage_rules WHERE user_id = ? AND rule_type = 'auto_read_channel' AND channel_name = ?"
  ).get(userId, name);
  if (existing) return false;
  db.prepare(
    "INSERT INTO triage_rules (user_id, rule_type, channel_name) VALUES (?, 'auto_read_channel', ?)"
  ).run(userId, name);
  return true;
}

function removeAutoReadChannel(userId, channelName) {
  const name = channelName.replace('#', '').toLowerCase();
  const result = db.prepare(
    "DELETE FROM triage_rules WHERE user_id = ? AND rule_type = 'auto_read_channel' AND channel_name = ?"
  ).run(userId, name);
  return result.changes > 0;
}

function isAutoReadChannel(userId, channelName) {
  return !!db.prepare(
    "SELECT id FROM triage_rules WHERE user_id = ? AND rule_type = 'auto_read_channel' AND channel_name = ?"
  ).get(userId, channelName.toLowerCase());
}

function addIgnorePattern(userId, pattern) {
  const existing = db.prepare(
    "SELECT id FROM triage_rules WHERE user_id = ? AND rule_type = 'ignore_pattern' AND pattern = ?"
  ).get(userId, pattern);
  if (existing) return false;
  db.prepare(
    "INSERT INTO triage_rules (user_id, rule_type, pattern) VALUES (?, 'ignore_pattern', ?)"
  ).run(userId, pattern);
  return true;
}

function removeIgnorePattern(userId, pattern) {
  const result = db.prepare(
    "DELETE FROM triage_rules WHERE user_id = ? AND rule_type = 'ignore_pattern' AND pattern = ?"
  ).run(userId, pattern);
  return result.changes > 0;
}

function matchesIgnorePattern(userId, text) {
  const patterns = db.prepare(
    "SELECT pattern FROM triage_rules WHERE user_id = ? AND rule_type = 'ignore_pattern'"
  ).all(userId);
  const lower = text.toLowerCase();
  return patterns.some(p => lower.includes(p.pattern.toLowerCase()));
}

function addChannelRule(userId, channelName, { defaultAction, alertWhen, readWhen }) {
  const name = channelName.replace('#', '').toLowerCase();
  if (defaultAction) {
    const existing = db.prepare(
      "SELECT id FROM triage_rules WHERE user_id = ? AND rule_type = 'channel_default' AND channel_name = ?"
    ).get(userId, name);
    if (existing) {
      db.prepare("UPDATE triage_rules SET default_action = ? WHERE id = ?").run(defaultAction, existing.id);
    } else {
      db.prepare(
        "INSERT INTO triage_rules (user_id, rule_type, channel_name, default_action) VALUES (?, 'channel_default', ?, ?)"
      ).run(userId, name, defaultAction);
    }
  }
  if (alertWhen) {
    const existing = db.prepare(
      "SELECT id FROM triage_rules WHERE user_id = ? AND rule_type = 'channel_alert' AND channel_name = ? AND pattern = ?"
    ).get(userId, name, alertWhen);
    if (!existing) {
      db.prepare(
        "INSERT INTO triage_rules (user_id, rule_type, channel_name, pattern) VALUES (?, 'channel_alert', ?, ?)"
      ).run(userId, name, alertWhen);
    }
  }
  if (readWhen) {
    const existing = db.prepare(
      "SELECT id FROM triage_rules WHERE user_id = ? AND rule_type = 'channel_read' AND channel_name = ? AND pattern = ?"
    ).get(userId, name, readWhen);
    if (!existing) {
      db.prepare(
        "INSERT INTO triage_rules (user_id, rule_type, channel_name, pattern) VALUES (?, 'channel_read', ?, ?)"
      ).run(userId, name, readWhen);
    }
  }
}

function applyChannelRule(userId, channelName, text) {
  const name = channelName.toLowerCase();
  const lower = text.toLowerCase();

  // Check alert patterns
  const alerts = db.prepare(
    "SELECT pattern FROM triage_rules WHERE user_id = ? AND rule_type = 'channel_alert' AND channel_name = ?"
  ).all(userId, name);
  for (const a of alerts) {
    if (lower.includes(a.pattern.toLowerCase())) {
      return { classification: 'attention', reason: `Matched alert rule: "${a.pattern}"` };
    }
  }

  // Check read patterns
  const reads = db.prepare(
    "SELECT pattern FROM triage_rules WHERE user_id = ? AND rule_type = 'channel_read' AND channel_name = ?"
  ).all(userId, name);
  for (const r of reads) {
    if (lower.includes(r.pattern.toLowerCase())) {
      return { classification: 'noise', reason: `Matched read rule: "${r.pattern}"` };
    }
  }

  // Check default
  const def = db.prepare(
    "SELECT default_action FROM triage_rules WHERE user_id = ? AND rule_type = 'channel_default' AND channel_name = ?"
  ).get(userId, name);
  if (def) {
    return { classification: def.default_action, reason: `Channel default: ${def.default_action}` };
  }

  return null;
}

function getUserRulesSummary(userId) {
  const autoRead = db.prepare(
    "SELECT channel_name FROM triage_rules WHERE user_id = ? AND rule_type = 'auto_read_channel'"
  ).all(userId).map(r => r.channel_name);
  const ignorePatterns = db.prepare(
    "SELECT pattern FROM triage_rules WHERE user_id = ? AND rule_type = 'ignore_pattern'"
  ).all(userId).map(r => r.pattern);
  const channelDefaults = db.prepare(
    "SELECT channel_name, default_action FROM triage_rules WHERE user_id = ? AND rule_type = 'channel_default'"
  ).all(userId);
  const channelAlerts = db.prepare(
    "SELECT channel_name, pattern FROM triage_rules WHERE user_id = ? AND rule_type = 'channel_alert'"
  ).all(userId);

  return { autoRead, ignorePatterns, channelDefaults, channelAlerts };
}

module.exports = {
  getRulesForUser, addAutoReadChannel, removeAutoReadChannel, isAutoReadChannel,
  addIgnorePattern, removeIgnorePattern, matchesIgnorePattern,
  addChannelRule, applyChannelRule, getUserRulesSummary,
};
