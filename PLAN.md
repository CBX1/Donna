# Donna — Build Plan & Status

## Overview
Donna is an AI-powered Slack bot inspired by Donna Paulsen from Suits. She proactively triages alert notifications, tracks PRs from DMs, manages tasks in Notion, sets reminders, and lets you interact via natural language conversation — all through Slack DMs.

## Tech Stack
- **Runtime**: Node.js
- **Bot Framework**: Slack Bolt SDK (Socket Mode)
- **AI**: Gemini 2.0 Flash (intent classification, message triage, conversation)
- **Database**: SQLite (reminders, lastQueried timestamps)
- **Task/PR Storage**: Notion API (shared database with Type column)
- **Config**: triage-rules.json (auto-read channels, ignore patterns)

## Architecture
```
Slack Bot (Slack Bolt SDK - Node.js)
  ├── Event listener → DMs and channel messages
  ├── Intent router (Gemini) → classifies user messages into 15 intents
  ├── Conversation engine → chat history + Donna personality + self-awareness
  ├── Triage scheduler (node-cron, every 5 min)
  │   ├── Fetches messages from 44 alert channels
  │   ├── Extracts text from attachments/blocks
  │   ├── Applies user rules (auto-read channels, ignore patterns)
  │   ├── Classifies remaining via Gemini (noise vs attention)
  │   └── Marks noise as read (user token)
  ├── PR tracker → detects PR review requests in DMs → stores in Notion
  ├── Task manager → CRUD tasks in Notion
  ├── Reminders → persisted in SQLite, survives restarts
  ├── Channel summary → fetches + summarizes any channel via Gemini
  └── Daily summary → EOD digest at 7:30 PM IST
```

## Project Structure
```
donna-slack-bot/
├── src/
│   ├── app.js                       # Entry point — Slack Bolt + all handlers wired
│   ├── config.js                    # Env vars
│   ├── db.js                        # SQLite setup (reminders, lastQueried)
│   ├── utils/
│   │   └── slack-format.js          # Shared Slack format parser (<#ID|name>, etc.)
│   ├── integrations/
│   │   ├── claude.js                # Gemini API client (ask, askJson, chat)
│   │   └── notion.js                # Notion CRUD (tasks + PRs, shared DB)
│   ├── chat/
│   │   ├── intent-router.js         # 15-intent classifier via Gemini
│   │   ├── conversation.js          # Conversational engine with history + self-awareness
│   │   └── handlers/
│   │       ├── pr-review.js         # "What PRs need my review?"
│   │       ├── reminders.js         # Set/query reminders
│   │       ├── channel-summary.js   # Summarize a Slack channel
│   │       └── tasks.js             # Notion task CRUD
│   ├── pr-tracker/
│   │   ├── detector.js              # PR detection from DMs → Notion
│   │   └── store.js                 # In-memory PR store (backup)
│   ├── reminders/
│   │   └── store.js                 # SQLite-backed reminder store
│   └── triage/
│       ├── classifier.js            # Gemini batch message classifier
│       ├── log.js                   # Triage log + lastQueried (SQLite-backed)
│       ├── rules.js                 # User-configurable rules (JSON file)
│       ├── scheduler.js             # Cron-based triage sweep
│       └── summary.js              # Daily EOD summary generator
├── manifest.yml                     # Slack app manifest
├── triage-rules.json                # User triage rules (auto-read, ignore patterns)
├── donna.db                         # SQLite database
├── .env                             # Secrets (gitignored)
├── .gitignore
├── PLAN.md                          # This file
└── package.json
```

## Slack App Config
- **App Name**: Donna
- **App ID**: A0AP0UQ9F42
- **Socket Mode**: enabled
- **Events**: message.im, message.channels, message.groups, app_mention
- **Bot scopes**: app_mentions:read, channels:history, channels:join, channels:read, chat:write, files:read, files:write, groups:history, groups:read, im:history, im:read, im:write, links:read, reactions:read, reactions:write, users:read
- **User scopes**: channels:write (mark-as-read)

## Tokens / Env Vars
| Variable | Source | Status |
|----------|--------|--------|
| SLACK_APP_TOKEN | Slack app settings | ✅ Set |
| SLACK_BOT_TOKEN | Slack OAuth | ✅ Set |
| SLACK_USER_TOKEN | Slack OAuth | ✅ Set |
| GEMINI_API_KEY | Google AI Studio | ✅ Set |
| NOTION_API_KEY | Notion integration | ✅ Set |
| NOTION_TASKS_DB_ID | Notion database | ✅ Set |
| TRIAGE_CHANNELS | 44 channel IDs | ✅ Set |
| SUMMARY_USER_ID | U071RRL7Y5S (Diksha) | ✅ Set |

## Build Phases — Status

### Phase 0: Project Setup ✅
- Node.js project, dependencies, .env, manifest

### Phase 1: Slack App + Basic Bot ✅
- Socket Mode connection, DM handling, @mention handling

### Phase 2: Gemini Integration + Intent Router ✅
- 15 intents: pr_review, task_create, task_query, task_update, reminder_set, reminder_query, channel_summary, triage_status, triage_rule_add, triage_rule_remove, triage_rules_list, daily_summary, calendar_query, calendar_create, general

### Phase 3: Alert Triage ✅
- 44 channels monitored every 5 min
- Catches up on today's unread messages on startup
- Extracts text from attachments/blocks (not just message.text)
- User-configurable rules: auto-read channels + ignore patterns
- Marks noise as read via user token
- Triage log with per-user "since last asked" tracking (SQLite-backed)

### Phase 4: PR Review Tracking ✅
- Detects PR review requests in DMs via Gemini
- Stores in Notion (Type: PR Review) with context, assignee, URL
- Also keeps in-memory store as fallback
- Does NOT mark DMs as read

### Phase 5a: Task Management (Notion) ✅
- Shared Notion database with Type column (Task / PR Review)
- Columns: Name, Status, Type, Assignee, URL, Created
- Create, query, update tasks via DM

### Phase 5b: Reminders ✅
- SQLite-backed — survives restarts
- Restores pending reminders on startup
- Time parsing: "at 4pm", "in 2 hours", "tomorrow at 10am"
- Donna DMs you when reminder fires

### Phase 5c: Channel Summary ✅
- Resolves channels from Slack format (<#ID|name>), IDs, or names
- Fetches history + summarizes via Gemini

### Phase 6: Daily Summary ✅
- Scheduled at 7:30 PM IST (cron: 30 14 * * *)
- Includes triage stats + pending PRs + stale PR warnings
- Also available on-demand: "give me the daily summary"

### Phase 7: VM Deployment ✅
- VM: diffai2@diksha-diffai2.gcp.cbx1.internal
- Node.js v20.20.2, PM2 installed globally
- Code at ~/donna-slack-bot/
- PM2 process: `donna` (auto-restart on reboot via systemd)
- Deploy command: `rsync` from local → VM, then `pm2 restart donna`

### Phase 8: Self-Evolution (evolve command) ✅
- DM Donna with `evolve: <instruction>` to modify her own code
- Reads her own source files, sends to Gemini, applies changes, restarts via PM2
- **Locked to Diksha's Slack user ID only** (U071RRL7Y5S)
- Editable files whitelist in evolve.js

### Improvements Applied ✅
- Donna Paulsen personality (sassy, witty, confident)
- Conversational mode with chat history + self-awareness
- Varied acknowledgements (randomized, not always "On it...")
- Shared slack-format.js utility for parsing Slack references
- SQLite for persistent storage (reminders, lastQueried)
- Error handling with user-friendly messages

### Stretch Goals (Not Built)
- [ ] Google Calendar integration
- [ ] GitHub API PR status enrichment
- [ ] Multi-user support (per-user OAuth)
- [ ] Web dashboard / PWA
- [ ] Learning from user corrections (feedback loop)

## Notion Doc
https://www.notion.so/cbx1/Hackathon-32eb8ace64ab8012aa23ea23c981be33

## Key Files to Read First
1. `src/app.js` — main entry point, all handlers wired
2. `src/chat/intent-router.js` — intent classification prompt
3. `src/chat/conversation.js` — conversational personality + self-awareness
4. `src/triage/scheduler.js` — triage sweep logic
5. `.env` — all tokens and config
