/**
 * Shared time utilities. All times in IST (Asia/Kolkata, UTC+5:30).
 */

const TZ = 'Asia/Kolkata';

/**
 * Get current date in IST as YYYY-MM-DD string.
 */
function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // en-CA gives YYYY-MM-DD
}

/**
 * Get current time as ISO string in IST context.
 */
function nowIST() {
  return new Date().toISOString();
}

/**
 * Get IST date string for display.
 */
function formatDateIST(date) {
  return new Date(date).toLocaleString('en-IN', { timeZone: TZ });
}

function formatAge(timestamp) {
  const diff = Date.now() - new Date(timestamp).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function parseTime(timeStr) {
  if (!timeStr) return null;

  // ISO 8601
  const isoDate = new Date(timeStr);
  if (!isNaN(isoDate.getTime()) && timeStr.includes('-')) return isoDate;

  const now = new Date();
  const lower = timeStr.toLowerCase().trim();

  // "in X hours/minutes", "next X minutes", "in next X minutes", "after X minutes"
  const inMatch = lower.match(/(?:in\s+(?:next\s+)?|next\s+|after\s+)(\d+)\s+(hour|minute|min|hr)s?/);
  if (inMatch) {
    const amount = parseInt(inMatch[1]);
    const unit = inMatch[2].startsWith('hour') || inMatch[2].startsWith('hr') ? 'hours' : 'minutes';
    const ms = unit === 'hours' ? amount * 60 * 60 * 1000 : amount * 60 * 1000;
    return new Date(now.getTime() + ms);
  }

  // "half an hour", "in half an hour"
  if (lower.match(/half\s+an?\s+hour/)) {
    return new Date(now.getTime() + 30 * 60 * 1000);
  }

  // "tomorrow at Xam/pm"
  const tomorrowMatch = lower.match(/tomorrow\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (tomorrowMatch) {
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    let hours = parseInt(tomorrowMatch[1]);
    const minutes = tomorrowMatch[2] ? parseInt(tomorrowMatch[2]) : 0;
    const ampm = tomorrowMatch[3];
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  // "at X:XXam/pm" or "Xpm"
  const timeMatch = lower.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (timeMatch) {
    const date = new Date(now);
    let hours = parseInt(timeMatch[1]);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const ampm = timeMatch[3];
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
    date.setHours(hours, minutes, 0, 0);
    if (date <= now) date.setDate(date.getDate() + 1);
    return date;
  }

  const fallback = new Date(timeStr);
  if (!isNaN(fallback.getTime())) return fallback;
  return null;
}

module.exports = { formatAge, parseTime, todayIST, nowIST, formatDateIST, TZ };
