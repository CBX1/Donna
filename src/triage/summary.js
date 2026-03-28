const cron = require('node-cron');
const triageLog = require('./log');
const prStore = require('../pr-tracker/store');

/**
 * Start the daily summary scheduler.
 * @param {Function} sendDm - Function to send DM: (userId, text) => Promise
 * @param {string} userId - Slack user ID to send summary to
 * @param {string} cronSchedule - Cron expression (default: 7:30 PM IST)
 */
function start(sendDm, userId, cronSchedule = '30 14 * * *') {
  // 14:30 UTC = 7:30 PM IST (UTC+5:30)
  console.log('📊 Daily summary scheduled for 7:30 PM IST');

  cron.schedule(cronSchedule, async () => {
    console.log('[Summary] Generating daily summary...');
    try {
      const message = generateSummary();
      await sendDm(userId, message);
      console.log('[Summary] Daily summary sent!');
    } catch (err) {
      console.error('[Summary] Failed to send:', err.message);
    }
  });
}

/**
 * Generate the daily summary message.
 */
function generateSummary() {
  const stats = triageLog.getTodayStats();
  const pendingPrs = prStore.getPending();
  const stalePrs = prStore.getStale(24);

  const lines = [];
  lines.push("*Hey — here's your end-of-day wrap-up from Donna.*");
  lines.push('');

  // Triage section
  const total = stats.totalNoise + stats.totalAttention;
  if (total === 0) {
    lines.push("Quiet day on the alert front. Nothing came through.");
  } else {
    lines.push(`I went through *${total} messages* across your alert channels today.`);
    lines.push(`  ✅ Cleared as noise: ${stats.totalNoise}`);
    lines.push(`  ⚠️ Flagged for you: ${stats.totalAttention}`);

    if (stats.totalNoise > 0) {
      lines.push('');
      lines.push('*Marked as read by channel:*');
      Object.entries(stats.noiseByChannel)
        .sort((a, b) => b[1] - a[1])
        .forEach(([ch, count]) => {
          lines.push(`  • #${ch}: ${count}`);
        });
    }

    if (stats.attentionItems.length > 0) {
      lines.push('');
      lines.push('*Items that needed attention:*');
      // Group by channel
      const byChannel = {};
      stats.attentionItems.forEach(a => {
        if (!byChannel[a.channel]) byChannel[a.channel] = 0;
        byChannel[a.channel]++;
      });
      Object.entries(byChannel)
        .sort((a, b) => b[1] - a[1])
        .forEach(([ch, count]) => {
          lines.push(`  • #${ch}: ${count}`);
        });
    }
  }

  // PR section
  lines.push('');
  if (pendingPrs.length === 0) {
    lines.push("No PRs waiting on you. Clean conscience. 😌");
  } else {
    lines.push(`*${pendingPrs.length} PR${pendingPrs.length > 1 ? 's' : ''} still need your review:*`);
    pendingPrs.forEach(pr => {
      const age = formatAge(pr.timestamp);
      lines.push(`  • ${pr.context} — from ${pr.assignee}, ${age}`);
    });

    if (stalePrs.length > 0) {
      lines.push(`\n  🚨 *${stalePrs.length} of those are over 24 hours old.* Don't make them wait.`);
    }
  }

  lines.push('');
  lines.push("_That's your day. I'll be here tomorrow doing it all again. — Donna_");

  return lines.join('\n');
}

function formatAge(timestamp) {
  const diff = Date.now() - new Date(timestamp).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

module.exports = { start, generateSummary };
