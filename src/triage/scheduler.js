const cron = require('node-cron');
const log = require('../utils/logger').child({ module: 'triage' });
const classifier = require('./classifier');
const triageLogStore = require('../stores/triage-log-store');
const triageRulesStore = require('../stores/triage-rules-store');
const mentionWatchStore = require('../stores/mention-watch-store');
const userStore = require('../stores/user-store');
const userRegistry = require('../core/user-registry');
const health = require('../core/health');
const db = require('../db');

// Cache channel names
const channelNames = {};

// Persisted last-processed timestamps (per-user, per-channel)
const getLastProcessedStmt = db.prepare('SELECT last_ts FROM triage_last_processed_v2 WHERE user_id = ? AND channel_id = ?');
const upsertLastProcessedStmt = db.prepare(
  'INSERT INTO triage_last_processed_v2 (user_id, channel_id, last_ts) VALUES (?, ?, ?) ON CONFLICT(user_id, channel_id) DO UPDATE SET last_ts = ?'
);

let _sendDm = null;

function start(botClient, userClient, options = {}) {
  _sendDm = options.sendDm;

  log.info('Triage scheduler started (every 5 min, multi-user)');

  cron.schedule('*/5 * * * *', async () => {
    await sweep(botClient, userClient);
    health.recordTriageSweep();
  });

  // Initial sweep
  sweep(botClient, userClient);
}

async function sweep(botClient, userClient) {
  const users = userStore.listOnboarded();
  if (users.length === 0) return;

  // Collect all unique channels across all users
  const channelUsers = {}; // channelId -> [{ userId, userToken }]
  for (const user of users) {
    const channels = userRegistry.getTriageChannels(user.id);
    for (const ch of channels) {
      if (!channelUsers[ch.channel_id]) channelUsers[ch.channel_id] = [];
      channelUsers[ch.channel_id].push({
        userId: user.id,
        userToken: user.slack_user_token,
      });
    }
  }

  // Fetch each channel once, apply per-user rules
  for (const [channelId, usersForChannel] of Object.entries(channelUsers)) {
    try {
      const channelName = await getChannelName(botClient, channelId);
      const messages = await fetchNewMessages(botClient, channelId, usersForChannel[0].userId);

      if (messages.length === 0) continue;

      // Check mention watches for this channel
      await checkMentions(channelId, channelName, messages);

      // Process per user
      for (const { userId, userToken } of usersForChannel) {
        await triageForUser(botClient, userClient, userId, userToken, channelId, channelName, messages);
      }

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      log.error({ err, channelId }, 'Error processing channel');
    }
  }
}

async function fetchNewMessages(botClient, channelId, sampleUserId) {
  const row = getLastProcessedStmt.get(sampleUserId, channelId);
  let oldest;
  if (row?.last_ts) {
    oldest = row.last_ts;
  } else {
    // First time seeing this channel — look back to start of today (IST)
    const now = new Date();
    const istMidnight = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    istMidnight.setHours(0, 0, 0, 0);
    oldest = String(istMidnight.getTime() / 1000);
  }

  // Auto-join channel if not already a member
  try { await botClient.conversations.join({ channel: channelId }); } catch { /* expected: already a member or insufficient perms */ }

  const history = await botClient.conversations.history({
    channel: channelId, oldest, limit: 100,
  });

  return (history.messages || [])
    .filter(m => !m.subtype || m.subtype === 'bot_message')
    .reverse();
}

async function triageForUser(botClient, userClient, userId, userToken, channelId, channelName, messages) {
  if (messages.length === 0) return;

  // Update last processed
  upsertLastProcessedStmt.run(userId, channelId, messages[messages.length - 1].ts, messages[messages.length - 1].ts);

  const isAutoRead = triageRulesStore.isAutoReadChannel(userId, channelName);
  let totalNoise = 0, totalAttention = 0, latestNoiseTts = null;

  if (isAutoRead) {
    for (const msg of messages) {
      triageLogStore.add(userId, {
        channelId, channelName, classification: 'noise',
        reason: 'Auto-read channel', messageText: extractText(msg), messageTs: msg.ts,
      });
      totalNoise++;
      latestNoiseTts = msg.ts;
    }
  } else {
    const toClassify = [];
    const toClassifyMsgs = [];

    for (const msg of messages) {
      const text = extractText(msg);

      const channelRule = triageRulesStore.applyChannelRule(userId, channelName, text);
      if (channelRule) {
        triageLogStore.add(userId, {
          channelId, channelName, classification: channelRule.classification,
          reason: channelRule.reason, messageText: text, messageTs: msg.ts,
        });
        if (channelRule.classification === 'noise') { totalNoise++; latestNoiseTts = msg.ts; }
        else totalAttention++;
        continue;
      }

      if (triageRulesStore.matchesIgnorePattern(userId, text)) {
        triageLogStore.add(userId, {
          channelId, channelName, classification: 'noise',
          reason: 'Matched ignore pattern', messageText: text, messageTs: msg.ts,
        });
        totalNoise++;
        latestNoiseTts = msg.ts;
      } else {
        toClassify.push({ text, user: msg.username || msg.bot_profile?.name || 'unknown' });
        toClassifyMsgs.push(msg);
      }
    }

    // Classify with Gemini in batches
    for (let i = 0; i < toClassify.length; i += 20) {
      const batch = toClassify.slice(i, i + 20);
      const batchMsgs = toClassifyMsgs.slice(i, i + 20);
      const results = await classifier.classifyBatch(batch);

      for (const result of results) {
        const msg = batchMsgs[result.index];
        if (!msg) continue;
        triageLogStore.add(userId, {
          channelId, channelName, classification: result.classification,
          reason: result.reason, messageText: extractText(msg), messageTs: msg.ts,
        });
        if (result.classification === 'noise') { totalNoise++; latestNoiseTts = msg.ts; }
        else totalAttention++;
      }
    }
  }

  // Mark as read (using user's token if available)
  if (latestNoiseTts && userToken) {
    try {
      const client = new (require('@slack/web-api').WebClient)(userToken);
      await client.conversations.mark({ channel: channelId, ts: latestNoiseTts });
    } catch (err) { log.error({ err }, 'conversations.mark failed'); }
  }

  if (totalNoise > 0 || totalAttention > 0) {
    const metrics = require('../core/metrics');
    metrics.increment('triageNoise', totalNoise);
    metrics.increment('triageAttention', totalAttention);
    log.info({ channelName, userId: userId.substring(0, 6), totalNoise, totalAttention }, 'channel triaged');
  }
}

async function checkMentions(channelId, channelName, messages) {
  if (!_sendDm) return;
  const watchers = mentionWatchStore.getForChannel(channelId);
  if (watchers.length === 0) return;

  for (const msg of messages) {
    const text = extractText(msg);
    const lower = text.toLowerCase();

    for (const watcher of watchers) {
      if (watcher.patterns.some(p => lower.includes(p.toLowerCase()))) {
        const preview = text.substring(0, 150);
        _sendDm(watcher.user_id, `*You were mentioned in #${channelName}:*\n> ${preview}`)
          .catch(err => log.error({ err }, 'Mention watch DM failed'));
      }
    }
  }
}

async function getChannelName(botClient, channelId) {
  if (channelNames[channelId]) return channelNames[channelId];
  try {
    const info = await botClient.conversations.info({ channel: channelId });
    channelNames[channelId] = info.channel?.name || channelId;
  } catch {
    channelNames[channelId] = channelId;
  }
  return channelNames[channelId];
}

function extractText(msg) {
  let parts = [];
  if (msg.text) parts.push(msg.text);
  if (msg.attachments) {
    for (const att of msg.attachments) {
      if (att.text) parts.push(att.text);
      else if (att.fallback) parts.push(att.fallback);
      else if (att.title) parts.push(att.title);
    }
  }
  if (msg.blocks) {
    for (const block of msg.blocks) {
      if (block.text?.text) parts.push(block.text.text);
      if (block.elements) {
        for (const el of block.elements) {
          if (el.text) parts.push(typeof el.text === 'string' ? el.text : el.text.text || '');
          if (el.elements) el.elements.forEach(sub => { if (sub.text) parts.push(sub.text); });
        }
      }
    }
  }
  return parts.join(' ').trim() || '(no content)';
}

module.exports = { start };
