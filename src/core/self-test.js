const log = require('../utils/logger').child({ module: 'self-test' });
const config = require('../config');

/**
 * Run integration self-tests on startup.
 * Returns { ok, results } where each result is { name, ok, ms, error? }.
 * Throws if a critical integration (slack, sqlite) fails.
 */
async function run(app) {
  const results = [];

  // 1. SQLite
  results.push(await test('sqlite', () => {
    const db = require('../db');
    db.prepare('SELECT 1').get();
  }));

  // 2. Slack
  results.push(await test('slack', async () => {
    const res = await app.client.auth.test();
    if (!res.ok) throw new Error(res.error);
    return res.user;
  }));

  // 3. Gemini (if configured)
  if (config.gemini.apiKey) {
    results.push(await test('gemini', async () => {
      const gemini = require('../integrations/gemini');
      const res = await gemini.ask('Respond with just OK', 'test');
      if (!res) throw new Error('Empty response');
    }));
  }

  // 4. GitHub (if configured)
  if (config.github.token) {
    results.push(await test('github', async () => {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${config.github.token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.login;
    }));
  }

  // 5. Notion (if configured)
  if (config.notion.apiKey) {
    results.push(await test('notion', async () => {
      const res = await fetch('https://api.notion.com/v1/users/me', {
        headers: {
          Authorization: `Bearer ${config.notion.apiKey}`,
          'Notion-Version': '2022-06-28',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }));
  }

  const ok = results.every(r => r.ok || !r.critical);
  const failed = results.filter(r => !r.ok);

  for (const r of results) {
    if (r.ok) {
      log.info({ integration: r.name, ms: r.ms }, 'passed');
    } else {
      log.error({ integration: r.name, error: r.error }, 'FAILED');
    }
  }

  if (failed.some(r => r.critical)) {
    throw new Error(`Critical integration failed: ${failed.filter(r => r.critical).map(r => r.name).join(', ')}`);
  }

  return { ok, results };
}

async function test(name, fn) {
  const critical = name === 'sqlite' || name === 'slack';
  const start = Date.now();
  try {
    await fn();
    return { name, ok: true, ms: Date.now() - start, critical };
  } catch (err) {
    return { name, ok: false, ms: Date.now() - start, error: err.message, critical };
  }
}

module.exports = { run };
