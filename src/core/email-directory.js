const fs = require('fs');
const path = require('path');

const DIRECTORY_FILE = path.resolve(__dirname, '../../email-directory.json');

/**
 * Build email directory from Slack workspace and save to file.
 */
async function buildDirectory(slackClient) {
  const directory = {};
  let cursor;

  do {
    const result = await slackClient.users.list({ limit: 200, cursor });
    for (const user of result.members || []) {
      if (user.deleted || user.is_bot || user.id === 'USLACKBOT') continue;

      const email = user.profile?.email;
      if (!email) continue;

      const realName = (user.real_name || '').toLowerCase();
      const firstName = realName.split(' ')[0];
      const displayName = (user.profile?.display_name || '').toLowerCase();

      directory[user.id] = {
        name: user.real_name || '',
        email,
        firstName,
        displayName,
      };
    }
    cursor = result.response_metadata?.next_cursor;
  } while (cursor);

  fs.writeFileSync(DIRECTORY_FILE, JSON.stringify(directory, null, 2));
  console.log(`📧 Email directory built: ${Object.keys(directory).length} users`);
  return directory;
}

/**
 * Load directory from file.
 */
function loadDirectory() {
  try {
    if (fs.existsSync(DIRECTORY_FILE)) {
      return JSON.parse(fs.readFileSync(DIRECTORY_FILE, 'utf8'));
    }
  } catch (err) { console.error('[EmailDirectory] loadDirectory failed:', err.message); }
  return {};
}

/**
 * Resolve a name to an email address.
 * Searches by first name, full name, and display name.
 */
function resolveEmail(name) {
  const directory = loadDirectory();
  const lower = name.toLowerCase().trim();

  for (const entry of Object.values(directory)) {
    if (entry.firstName === lower) return entry.email;
    if (entry.name.toLowerCase() === lower) return entry.email;
    if (entry.displayName === lower) return entry.email;
  }

  return null;
}

/**
 * Resolve multiple names/emails to email addresses.
 */
function resolveEmails(names) {
  if (!names || names.length === 0) return [];

  const emails = [];
  const notFound = [];

  for (const name of names) {
    if (name.includes('@')) {
      emails.push(name);
      continue;
    }

    const email = resolveEmail(name);
    if (email) {
      emails.push(email);
    } else {
      notFound.push(name);
    }
  }

  return { emails, notFound };
}

module.exports = { buildDirectory, loadDirectory, resolveEmail, resolveEmails };
