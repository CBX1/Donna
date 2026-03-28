const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

// Force IST timezone for all Date operations
process.env.TZ = 'Asia/Kolkata';

module.exports = {
  slack: {
    appToken: process.env.SLACK_APP_TOKEN,
    botToken: process.env.SLACK_BOT_TOKEN,
    userToken: process.env.SLACK_USER_TOKEN,
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
  },
  triage: {
    channels: (process.env.TRIAGE_CHANNELS || '').split(',').filter(Boolean),
  },
  prWatch: {
    channels: (process.env.PR_WATCH_CHANNELS || '').split(',').filter(Boolean),
  },
  summary: {
    userId: process.env.SUMMARY_USER_ID,
  },
  github: {
    token: process.env.GITHUB_TOKEN,
    username: process.env.GITHUB_USERNAME,
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  },
  notion: {
    apiKey: process.env.NOTION_API_KEY,
    tasksDatabaseId: process.env.NOTION_TASKS_DB_ID || null,
  },
};
