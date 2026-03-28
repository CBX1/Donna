const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const log = require('../utils/logger').child({ module: 'evolve' });
const claude = require('../integrations/gemini');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

// Files Donna is allowed to read and modify
const EDITABLE_FILES = [
  'src/app.js',
  'src/config.js',
  'src/chat/intent-router.js',
  'src/chat/conversation.js',
  'src/chat/handlers/pr-review.js',
  'src/chat/handlers/reminders.js',
  'src/chat/handlers/channel-summary.js',
  'src/chat/handlers/tasks.js',
  'src/chat/handlers/evolve.js',
  'src/triage/classifier.js',
  'src/triage/log.js',
  'src/triage/rules.js',
  'src/triage/scheduler.js',
  'src/triage/summary.js',
  'src/integrations/claude.js',
  'src/integrations/notion.js',
  'src/pr-tracker/detector.js',
  'src/pr-tracker/store.js',
  'src/reminders/store.js',
  'src/utils/slack-format.js',
  'src/db.js',
  'triage-rules.json',
];

const SYSTEM_PROMPT = `You are Donna's self-modification engine. You receive an instruction from the user about how Donna (a Slack bot) should change, along with Donna's current source code.

Your job is to generate the exact file changes needed.

Respond with ONLY a JSON object:
{
  "plan": "<1-2 sentence description of what you'll change>",
  "changes": [
    {
      "file": "<relative file path>",
      "action": "edit",
      "old_text": "<exact text to find and replace>",
      "new_text": "<replacement text>"
    }
  ]
}

Rules:
- "old_text" must be an EXACT substring of the current file content. Include enough context to be unique.
- Only modify files that need to change. Be minimal.
- Do NOT change .env, package.json, or db.js unless explicitly asked.
- Keep Donna's personality (Donna Paulsen from Suits — sassy, witty, confident).
- If the instruction is unclear or risky, return: { "plan": "I need more details", "changes": [] }
- Always maintain working code. Don't break imports or syntax.`;

/**
 * Read Donna's source files for context.
 */
function readSourceFiles() {
  const files = {};
  for (const relPath of EDITABLE_FILES) {
    const fullPath = path.join(PROJECT_ROOT, relPath);
    try {
      if (fs.existsSync(fullPath)) {
        files[relPath] = fs.readFileSync(fullPath, 'utf8');
      }
    } catch (err) { log.error({ err }, 'readSourceFiles failed'); }
  }
  return files;
}

/**
 * Apply file changes.
 */
function applyChanges(changes) {
  const applied = [];
  const errors = [];

  for (const change of changes) {
    const fullPath = path.join(PROJECT_ROOT, change.file);

    // Safety: only allow editing known files
    if (!EDITABLE_FILES.includes(change.file)) {
      errors.push(`Skipped ${change.file} — not in the editable list`);
      continue;
    }

    try {
      if (change.action === 'edit') {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (!content.includes(change.old_text)) {
          errors.push(`${change.file}: couldn't find the text to replace`);
          continue;
        }
        const newContent = content.replace(change.old_text, change.new_text);
        fs.writeFileSync(fullPath, newContent);
        applied.push(change.file);
      } else if (change.action === 'create') {
        fs.writeFileSync(fullPath, change.new_text);
        applied.push(`${change.file} (created)`);
      }
    } catch (err) {
      errors.push(`${change.file}: ${err.message}`);
    }
  }

  return { applied, errors };
}

/**
 * Restart Donna via PM2.
 */
function restart() {
  try {
    execSync('pm2 restart donna', { timeout: 10000 });
    return true;
  } catch (err) {
    log.error({ err }, 'PM2 restart failed');
    return false;
  }
}

/**
 * Handle an evolve request.
 * @param {string} instruction - What the user wants to change
 * @param {Function} say - Slack say function for progress updates
 */
async function handle(instruction, say) {
  // Step 1: Read current source
  await say("*Evolving...* Let me look at my code and figure out the changes.");
  const sources = readSourceFiles();

  // Build context (truncate large files)
  const sourceContext = Object.entries(sources)
    .map(([file, content]) => `=== ${file} ===\n${content.substring(0, 5000)}`)
    .join('\n\n');

  // Step 2: Ask Gemini for changes
  const userMsg = `Instruction: ${instruction}\n\nCurrent source code:\n${sourceContext}`;

  let result;
  try {
    result = await claude.askJson(SYSTEM_PROMPT, userMsg);
  } catch (err) {
    return `I tried to figure out the changes but hit an error: ${err.message}`;
  }

  if (!result.changes || result.changes.length === 0) {
    return `*Plan:* ${result.plan}\n\nNo code changes needed — or I need more details. Tell me more?`;
  }

  // Step 3: Show plan and apply
  await say(`*Plan:* ${result.plan}\n*Files to change:* ${result.changes.map(c => c.file).join(', ')}\n\nApplying changes...`);

  const { applied, errors } = applyChanges(result.changes);

  let response = '';
  if (applied.length > 0) {
    response += `*Applied:* ${applied.join(', ')}\n`;
  }
  if (errors.length > 0) {
    response += `*Errors:* ${errors.join('; ')}\n`;
  }

  // Step 4: Restart
  if (applied.length > 0) {
    response += '\nRestarting myself...';
    await say(response);

    // Small delay to let the message send before restart
    setTimeout(() => {
      restart();
    }, 2000);

    return null; // Already sent via say
  }

  return response || "No changes were applied.";
}

module.exports = { handle };
