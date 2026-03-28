const { google } = require('googleapis');
const config = require('../config');
const log = require('../utils/logger').child({ module: 'calendar' });
const userStore = require('../stores/user-store');

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const REDIRECT_URI = 'https://www.different.ai/';

// Track pending auth flows per user
const pendingAuth = {};

/**
 * Generate an auth URL for the user to visit.
 * Returns the URL. User pastes the code back to Donna.
 */
function getAuthUrl(userId) {
  const oauth2Client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    REDIRECT_URI
  );

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  pendingAuth[userId] = true;
  return url;
}

/**
 * Exchange an auth code for tokens and store them.
 */
async function exchangeCode(userId, code) {
  const oauth2Client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    REDIRECT_URI
  );

  const { tokens } = await oauth2Client.getToken(code);

  userStore.update(userId, {
    google_access_token: tokens.access_token,
    google_refresh_token: tokens.refresh_token || null,
    google_token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
  });

  delete pendingAuth[userId];
  log.info({ userId }, 'Google auth complete');
  return true;
}

/**
 * Check if user has a pending auth flow.
 */
function hasPendingAuth(userId) {
  return !!pendingAuth[userId];
}

function clearPendingAuth(userId) {
  delete pendingAuth[userId];
}

/**
 * Get an authenticated OAuth2 client for a user.
 */
async function getAuthClient(userId) {
  const user = userStore.getById(userId);
  if (!user?.google_access_token) return null;

  const oauth2Client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: user.google_access_token,
    refresh_token: user.google_refresh_token,
  });

  // Refresh if expired
  if (user.google_token_expiry && new Date(user.google_token_expiry) < new Date()) {
    if (user.google_refresh_token) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        userStore.update(userId, {
          google_access_token: credentials.access_token,
          google_token_expiry: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
        });
        oauth2Client.setCredentials(credentials);
      } catch (err) {
        log.error({ err }, 'Token refresh failed');
        return null;
      }
    } else {
      return null;
    }
  }

  return oauth2Client;
}

/**
 * Get events for a date.
 */
async function getEvents(userId, date) {
  const auth = await getAuthClient(userId);
  if (!auth) return null;

  const calendar = google.calendar({ version: 'v3', auth });

  let startDate, endDate;
  const now = new Date();

  if (date === 'today' || !date) {
    startDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1);
  } else if (date === 'tomorrow') {
    startDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    startDate.setHours(0, 0, 0, 0);
    startDate.setDate(startDate.getDate() + 1);
    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1);
  } else {
    startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1);
  }

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: startDate.toISOString(),
    timeMax: endDate.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 20,
  });

  return (res.data.items || []).map(event => ({
    title: event.summary || 'No title',
    start: event.start?.dateTime || event.start?.date,
    end: event.end?.dateTime || event.end?.date,
    attendees: (event.attendees || []).map(a => a.email).slice(0, 5),
    link: event.hangoutLink || event.htmlLink,
  }));
}

/**
 * Create a calendar event.
 */
async function createEvent(userId, { title, startTime, endTime, attendees, description }) {
  const auth = await getAuthClient(userId);
  if (!auth) return null;

  const calendar = google.calendar({ version: 'v3', auth });

  const event = {
    summary: title,
    description,
    start: { dateTime: startTime, timeZone: 'Asia/Kolkata' },
    end: { dateTime: endTime, timeZone: 'Asia/Kolkata' },
    conferenceData: {
      createRequest: { requestId: `donna-${Date.now()}` },
    },
  };

  if (attendees?.length) {
    event.attendees = attendees.map(email => ({ email }));
  }

  const res = await calendar.events.insert({
    calendarId: 'primary',
    resource: event,
    conferenceDataVersion: 1,
    sendUpdates: 'all',
  });

  return {
    title: res.data.summary,
    start: res.data.start?.dateTime,
    link: res.data.hangoutLink || res.data.htmlLink,
    id: res.data.id,
  };
}

module.exports = { getAuthUrl, exchangeCode, hasPendingAuth, clearPendingAuth, getAuthClient, getEvents, createEvent };
