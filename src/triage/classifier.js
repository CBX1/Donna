const claude = require('../integrations/gemini');
const log = require('../utils/logger').child({ module: 'triage' });

const SYSTEM_PROMPT = `You are Donna, a Slack alert triage assistant. Your job is to classify Slack messages as either "noise" or "attention".

Rules:
- "noise": Routine success messages that need no action. Examples:
  - Deploy/build succeeded
  - Health check passed
  - Cron job completed with 0 errors
  - PR merged (routine)
  - Automated "all clear" notifications
  - Monitoring alerts that show normal values
  - Test suite passed

- "attention": Messages that need human review. Examples:
  - Deploy/build FAILED
  - Health check errors or anomalies
  - Cron job with errors
  - High resource usage warnings (disk, CPU, memory)
  - Someone asking a question or requesting help
  - Incidents, outages, blockers
  - Unusual error counts or patterns
  - Security alerts

Respond with ONLY a JSON array (no markdown). Each element:
{ "index": <message index>, "classification": "noise" | "attention", "reason": "<5-7 word reason>" }

When in doubt, classify as "attention" — it's safer to surface something unnecessary than to miss something important.`;

/**
 * Classify a batch of messages as noise or attention.
 * @param {Array<{text: string, user: string}>} messages
 * @returns {Promise<Array<{index: number, classification: string, reason: string}>>}
 */
async function classifyBatch(messages) {
  if (messages.length === 0) return [];

  const formatted = messages.map((m, i) => `[${i}] ${m.user}: ${m.text}`).join('\n');

  try {
    const results = await claude.askJson(SYSTEM_PROMPT, `Classify these messages:\n\n${formatted}`);
    return results;
  } catch (err) {
    log.error({ err }, 'Classification failed');
    // On failure, mark everything as attention (safe default)
    return messages.map((_, i) => ({
      index: i,
      classification: 'attention',
      reason: 'Classification failed — defaulting to attention',
    }));
  }
}

module.exports = { classifyBatch };
