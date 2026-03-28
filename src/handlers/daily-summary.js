const cron = require('node-cron');
const triageLogStore = require('../stores/triage-log-store');
const prStore = require('../stores/pr-store');
const userStore = require('../stores/user-store');
const { formatAge } = require('../utils/time');

function start(sendDm) {
  // Run every minute, check if it's any user's summary time
  cron.schedule('* * * * *', () => {
    const now = new Date();
    const currentTime = now.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
    });

    const users = userStore.listOnboarded();
    for (const user of users) {
      if (user.daily_summary_time === currentTime) {
        const summary = generate(user.id);
        sendDm(user.id, summary).catch(err =>
          console.error(`[Summary] Failed to send to ${user.display_name}:`, err.message)
        );
        console.log(`[Summary] Sent daily summary to ${user.display_name}`);
      }
    }
  });

  console.log('📊 Daily summary scheduler active');
}

function generate(userId) {
  const stats = triageLogStore.getTodayStats(userId);
  const pendingPrs = prStore.getPending(userId);

  const lines = [];
  lines.push("*Hey — here's your end-of-day wrap-up from Donna.*");
  lines.push('');

  const total = stats.totalNoise + stats.totalAttention;
  if (total === 0) {
    lines.push("Quiet day on the alert front. Nothing came through.");
  } else {
    lines.push(`I went through *${total} messages* across your alert channels today.`);
    lines.push(`  ✅ Cleared as noise: ${stats.totalNoise}`);
    lines.push(`  ⚠️ Flagged for you: ${stats.totalAttention}`);

    if (stats.totalNoise > 0) {
      lines.push('');
      lines.push('*Cleared by channel:*');
      Object.entries(stats.noiseByChannel)
        .sort((a, b) => b[1] - a[1])
        .forEach(([ch, count]) => lines.push(`  • #${ch}: ${count}`));
    }

    if (stats.totalAttention > 0) {
      lines.push('');
      lines.push('*Needed attention:*');
      Object.entries(stats.attentionByChannel)
        .sort((a, b) => b[1] - a[1])
        .forEach(([ch, count]) => lines.push(`  • #${ch}: ${count}`));
    }
  }

  lines.push('');
  if (pendingPrs.length === 0) {
    lines.push("No PRs waiting on you. Clean conscience.");
  } else {
    lines.push(`*${pendingPrs.length} PR${pendingPrs.length > 1 ? 's' : ''} still need your review:*`);
    pendingPrs.forEach(pr => lines.push(`  • ${pr.title || 'PR'} — by ${pr.author}, ${formatAge(pr.created_at)}`));
  }

  lines.push('');
  lines.push("_That's your day. I'll be here tomorrow. — Donna_");
  return lines.join('\n');
}

module.exports = { start, generate };
