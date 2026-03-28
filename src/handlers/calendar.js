const googleCalendar = require('../integrations/google-calendar');
const log = require('../utils/logger').child({ module: 'calendar' });
const userStore = require('../stores/user-store');
const emailDirectory = require('../core/email-directory');
const { parseTime } = require('../utils/time');

async function handleQuery(userId, params, sendDm) {
  const user = userStore.getById(userId);

  if (!user?.google_access_token) {
    return promptAuth(userId);
  }

  try {
    const date = params.date || 'today';
    const events = await googleCalendar.getEvents(userId, date);

    if (events === null) return promptAuth(userId);

    if (events.length === 0) {
      const dayLabel = date === 'today' ? 'today' : date === 'tomorrow' ? 'tomorrow' : `on ${date}`;
      return `Your calendar is clear ${dayLabel}. Rare flex — enjoy it.`;
    }

    const lines = events.map(e => {
      const start = new Date(e.start).toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true,
      });
      const end = new Date(e.end).toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true,
      });
      const attendeeStr = e.attendees.length > 0 ? ` — with ${e.attendees.slice(0, 3).join(', ')}` : '';
      const link = e.link ? ` <${e.link}|join>` : '';
      return `• *${start} – ${end}*: ${e.title}${attendeeStr}${link}`;
    });

    const dayLabel = (params.date || 'today') === 'today' ? 'today' : params.date === 'tomorrow' ? 'tomorrow' : params.date;
    return `*Your calendar for ${dayLabel} (${events.length} events):*\n${lines.join('\n')}`;
  } catch (err) {
    log.error({ err }, 'Query failed');
    if (err.message?.includes('invalid_grant') || err.message?.includes('Token')) {
      return promptAuth(userId);
    }
    return `Couldn't fetch your calendar: ${err.message}`;
  }
}

async function handleCreate(userId, params, sendDm) {
  const user = userStore.getById(userId);
  if (!user?.google_access_token) return promptAuth(userId);

  try {
    const dateStr = params.date || 'today';
    const timeStr = params.time || '10:00';
    const duration = params.duration_minutes || 30;

    let startDate;
    const now = new Date();

    if (dateStr === 'today') {
      startDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    } else if (dateStr === 'tomorrow') {
      startDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      startDate.setDate(startDate.getDate() + 1);
    } else {
      startDate = new Date(dateStr);
    }

    const timeParsed = parseTime(timeStr);
    if (timeParsed) {
      startDate.setHours(timeParsed.getHours(), timeParsed.getMinutes(), 0, 0);
    }

    const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

    // Resolve attendee names to emails via directory
    const { emails: attendeeEmails, notFound } = emailDirectory.resolveEmails(params.attendees || []);

    const result = await googleCalendar.createEvent(userId, {
      title: params.title || 'Meeting',
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
      attendees: attendeeEmails,
    });

    if (!result) return promptAuth(userId);

    const timeDisplay = startDate.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });

    let response = `Meeting created: *${result.title}*\n📅 ${timeDisplay} (${duration} min)`;
    if (result.link) response += `\n🔗 <${result.link}|Join meeting>`;
    if (attendeeEmails.length) response += `\n👥 Invited: ${attendeeEmails.join(', ')}`;
    if (notFound.length) response += `\n⚠️ Couldn't find emails for: ${notFound.join(', ')}`;
    return response;
  } catch (err) {
    log.error({ err }, 'Create failed');
    return `Couldn't create the meeting: ${err.message}`;
  }
}

/**
 * Handle Google auth code pasted by user.
 */
async function handleAuthCode(userId, code) {
  try {
    await googleCalendar.exchangeCode(userId, code.trim());
    return "Google Calendar connected! Now ask me about your schedule or create meetings.";
  } catch (err) {
    log.error({ err }, 'Code exchange failed');
    return `Auth failed: ${err.message}. Try again — ask me about your calendar.`;
  }
}

function promptAuth(userId) {
  const url = googleCalendar.getAuthUrl(userId);
  return `I need access to your Google Calendar.\n\n*Step 1:* Open this link:\n${url}\n\n*Step 2:* Sign in and grant calendar access\n\n*Step 3:* After granting access, you'll be redirected to different.ai. Look at the *URL bar* — it will contain \`?code=XXXX\`. Copy everything after \`code=\` (up to the \`&\` if there is one) and paste it here.\n\n_I'll be waiting!_`;
}

module.exports = { handleQuery, handleCreate, handleAuthCode };
