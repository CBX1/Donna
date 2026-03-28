const fs = require('fs');
const path = require('path');

const RULES_FILE = path.resolve(__dirname, '../../triage-rules.json');

/**
 * Rules structure:
 * {
 *   "auto_read_channels": ["channel-name"],
 *   "ignore_patterns": ["pattern1"],
 *   "always_alert_patterns": ["pattern1"],
 *   "channel_rules": {
 *     "channel-name": {
 *       "default": "noise" | "attention",
 *       "alert_when": ["pattern1"],   // override default to attention when matched
 *       "read_when": ["pattern1"]     // override default to noise when matched
 *     }
 *   }
 * }
 */

function load() {
  try {
    if (fs.existsSync(RULES_FILE)) {
      const rules = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
      if (!rules.channel_rules) rules.channel_rules = {};
      return rules;
    }
  } catch (err) {
    console.error('Failed to load triage rules:', err.message);
  }
  return { auto_read_channels: [], ignore_patterns: [], always_alert_patterns: [], channel_rules: {} };
}

function save(rules) {
  fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2));
}

function addAutoReadChannel(channelName) {
  const rules = load();
  const name = channelName.replace('#', '').toLowerCase();
  if (!rules.auto_read_channels.includes(name)) {
    rules.auto_read_channels.push(name);
    save(rules);
    return true;
  }
  return false;
}

function removeAutoReadChannel(channelName) {
  const rules = load();
  const name = channelName.replace('#', '').toLowerCase();
  const idx = rules.auto_read_channels.indexOf(name);
  if (idx !== -1) {
    rules.auto_read_channels.splice(idx, 1);
    save(rules);
    return true;
  }
  return false;
}

function addIgnorePattern(pattern) {
  const rules = load();
  if (!rules.ignore_patterns.includes(pattern)) {
    rules.ignore_patterns.push(pattern);
    save(rules);
    return true;
  }
  return false;
}

function removeIgnorePattern(pattern) {
  const rules = load();
  const idx = rules.ignore_patterns.indexOf(pattern);
  if (idx !== -1) {
    rules.ignore_patterns.splice(idx, 1);
    save(rules);
    return true;
  }
  return false;
}

function isAutoReadChannel(channelName) {
  const rules = load();
  return rules.auto_read_channels.includes(channelName.toLowerCase());
}

function matchesIgnorePattern(messageText) {
  const rules = load();
  const lower = messageText.toLowerCase();
  return rules.ignore_patterns.some(p => lower.includes(p.toLowerCase()));
}

/**
 * Check if a channel has custom classification rules.
 * Returns { hasRule, classification, reason } or null if no rule.
 */
function applyChannelRule(channelName, messageText) {
  const rules = load();
  const rule = rules.channel_rules[channelName.toLowerCase()];
  if (!rule) return null;

  const lower = messageText.toLowerCase();

  // Check alert_when patterns — if matched, it needs attention
  if (rule.alert_when) {
    for (const pattern of rule.alert_when) {
      if (lower.includes(pattern.toLowerCase())) {
        return { classification: 'attention', reason: `Matched alert rule: "${pattern}"` };
      }
    }
  }

  // Check read_when patterns — if matched, it's noise
  if (rule.read_when) {
    for (const pattern of rule.read_when) {
      if (lower.includes(pattern.toLowerCase())) {
        return { classification: 'noise', reason: `Matched read rule: "${pattern}"` };
      }
    }
  }

  // Apply default if set
  if (rule.default) {
    return { classification: rule.default, reason: `Channel default: ${rule.default}` };
  }

  return null;
}

/**
 * Add a channel-specific rule.
 */
function setChannelRule(channelName, { defaultAction, alertWhen, readWhen }) {
  const rules = load();
  const name = channelName.replace('#', '').toLowerCase();
  if (!rules.channel_rules[name]) {
    rules.channel_rules[name] = {};
  }
  if (defaultAction) rules.channel_rules[name].default = defaultAction;
  if (alertWhen) {
    if (!rules.channel_rules[name].alert_when) rules.channel_rules[name].alert_when = [];
    if (!rules.channel_rules[name].alert_when.includes(alertWhen)) {
      rules.channel_rules[name].alert_when.push(alertWhen);
    }
  }
  if (readWhen) {
    if (!rules.channel_rules[name].read_when) rules.channel_rules[name].read_when = [];
    if (!rules.channel_rules[name].read_when.includes(readWhen)) {
      rules.channel_rules[name].read_when.push(readWhen);
    }
  }
  save(rules);
}

/**
 * Get mention watch rules for a channel.
 * Returns { patterns, dmUser } or null.
 */
function getMentionWatch(channelName) {
  const rules = load();
  if (!rules.mention_watch) return null;
  return rules.mention_watch[channelName.toLowerCase()] || null;
}

/**
 * Add a mention watch rule for a channel.
 */
function addMentionWatch(channelName, userId, extraPatterns = []) {
  const rules = load();
  if (!rules.mention_watch) rules.mention_watch = {};
  const name = channelName.replace('#', '').toLowerCase();
  rules.mention_watch[name] = {
    patterns: ['diksha', userId, ...extraPatterns],
    dm_user: userId,
  };
  save(rules);
}

/**
 * Remove a mention watch rule for a channel.
 */
function removeMentionWatch(channelName) {
  const rules = load();
  if (!rules.mention_watch) return false;
  const name = channelName.replace('#', '').toLowerCase();
  if (rules.mention_watch[name]) {
    delete rules.mention_watch[name];
    save(rules);
    return true;
  }
  return false;
}

function getRules() {
  return load();
}

module.exports = {
  addAutoReadChannel,
  removeAutoReadChannel,
  addIgnorePattern,
  removeIgnorePattern,
  isAutoReadChannel,
  matchesIgnorePattern,
  applyChannelRule,
  setChannelRule,
  getMentionWatch,
  addMentionWatch,
  removeMentionWatch,
  getRules,
};
