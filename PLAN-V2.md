# Donna v2 — Re-Architecture Plan

## Why
The current code is hacky from iterative fixes: monolithic app.js, mixed persistence (in-memory + SQLite + Notion + JSON file), renamed-but-not-renamed Gemini client, single-user hardcoded everywhere. Time to clean up and go multi-user.

## Key Changes

### Architecture Cleanup
1. **Rename** `claude.js` → `gemini.js` (it's been Gemini all along)
2. **Slim app.js** from 300+ lines to ~60 — extract DM router, handlers
3. **Unified data layer** — everything in SQLite, no more in-memory stores or JSON files
4. **Drop Notion SDK** — use raw fetch everywhere (SDK v5 is broken)
5. **Shared utils** — `formatAge()`, `parseTime()` deduplicated into `utils/time.js`
6. **Notion becomes optional sync target** — SQLite is source of truth

### New Features
1. **Multi-user support** — any user can DM Donna, per-user triage/PRs/tasks/reminders
2. **Google Calendar** — query schedule, create meetings
3. **PR status check + auto-cleanup** — merged PRs auto-removed
4. **Mention watch via DM** — "watch #backend for my name"

## New Project Structure
```
donna-slack-bot/
├── src/
│   ├── app.js                          # SLIM: Bolt init + event wiring only
│   ├── config.js
│   ├── db.js                           # SQLite setup + migrations
│   ├── core/
│   │   ├── user-registry.js            # User CRUD, onboarding
│   │   ├── oauth-store.js              # Encrypted per-user tokens
│   │   └── permissions.js              # Admin check
│   ├── router/
│   │   ├── dm-router.js                # DM handler (extracted from app.js)
│   │   ├── mention-router.js           # @mention handler
│   │   └── intent-router.js            # Gemini intent classification
│   ├── handlers/                       # One file per intent
│   │   ├── pr-review.js
│   │   ├── reminders.js
│   │   ├── channel-summary.js
│   │   ├── tasks.js
│   │   ├── triage-status.js
│   │   ├── triage-rules.js
│   │   ├── daily-summary.js
│   │   ├── calendar.js                 # NEW
│   │   ├── mention-watch.js            # NEW
│   │   ├── onboarding.js              # NEW
│   │   └── evolve.js
│   ├── conversation/
│   │   └── engine.js                   # Chat history + Donna personality
│   ├── integrations/
│   │   ├── gemini.js                   # RENAMED from claude.js
│   │   ├── notion.js                   # All raw fetch
│   │   ├── github.js                   # NEW: dedicated GitHub client
│   │   └── google-calendar.js          # NEW
│   ├── triage/
│   │   ├── scheduler.js                # Multi-user aware
│   │   └── classifier.js
│   ├── pr-tracker/
│   │   ├── tracker.js                  # CONSOLIDATED detector + channel-watcher
│   │   └── status-checker.js           # NEW: auto-cleanup merged PRs
│   ├── stores/                         # UNIFIED SQLite data layer
│   │   ├── user-store.js
│   │   ├── triage-rules-store.js
│   │   ├── pr-store.js
│   │   ├── reminder-store.js
│   │   ├── triage-log-store.js
│   │   ├── mention-watch-store.js
│   │   └── conversation-store.js
│   └── utils/
│       ├── slack-format.js
│       ├── time.js                     # NEW: shared formatAge, parseTime
│       └── crypto.js                   # NEW: encrypt/decrypt tokens
├── migrations/
│   └── 001-multi-user.sql
├── .env
├── donna.db
└── package.json
```

## Database Schema

```sql
-- Users
CREATE TABLE users (
  id TEXT PRIMARY KEY,                    -- Slack user ID
  display_name TEXT NOT NULL,
  slack_user_token TEXT,                  -- Encrypted
  google_refresh_token TEXT,              -- Encrypted
  google_access_token TEXT,               -- Encrypted
  google_token_expiry TEXT,
  notion_database_id TEXT,
  timezone TEXT DEFAULT 'Asia/Kolkata',
  is_admin INTEGER DEFAULT 0,
  onboarding_complete INTEGER DEFAULT 0,
  daily_summary_time TEXT DEFAULT '19:30',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Per-user triage channels
CREATE TABLE user_triage_channels (
  user_id TEXT NOT NULL REFERENCES users(id),
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  PRIMARY KEY (user_id, channel_id)
);

-- Per-user triage rules (replaces triage-rules.json)
CREATE TABLE triage_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  rule_type TEXT NOT NULL,  -- 'auto_read_channel', 'ignore_pattern', 'channel_rule'
  channel_name TEXT,
  pattern TEXT,
  default_action TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Per-user mention watch
CREATE TABLE mention_watch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  patterns TEXT NOT NULL,  -- JSON array
  UNIQUE(user_id, channel_id)
);

-- Triage log (replaces in-memory array)
CREATE TABLE triage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  classification TEXT NOT NULL,
  reason TEXT,
  message_text TEXT,
  message_ts TEXT,
  logged_at TEXT DEFAULT (datetime('now')),
  log_date TEXT
);
CREATE INDEX idx_triage_log_user_date ON triage_log(user_id, log_date);

-- PR tracking (replaces in-memory + Notion)
CREATE TABLE pr_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  pr_url TEXT NOT NULL,
  title TEXT,
  author TEXT,
  status TEXT DEFAULT 'pending',
  gh_state TEXT,              -- 'open', 'closed', 'merged'
  gh_review_status TEXT,      -- 'approved', 'changes_requested', 'pending'
  detected_from TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, pr_url)
);

-- Triage last processed (per-user)
CREATE TABLE triage_last_processed_v2 (
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  last_ts TEXT NOT NULL,
  PRIMARY KEY (user_id, channel_id)
);

-- Conversation history (replaces in-memory)
CREATE TABLE conversation_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_convo_user ON conversation_history(user_id, created_at);
```

## Implementation Phases

### Phase 0: Foundation
- Create directory structure
- Write SQLite migration
- Rename claude.js → gemini.js
- Extract shared utils (formatAge, parseTime)
- Seed admin user (Diksha)

### Onboarding Flow (when someone DMs Donna for the first time)
Donna does NOT auto-onboard everyone. Only when a user explicitly DMs Donna asking to "start managing" or "set up" does onboarding begin:

1. Donna introduces herself with a summary of ALL capabilities:
   - Alert triage (monitors Slack channels, marks noise as read, daily summary)
   - PR tracking (detects PRs from DMs, monitors GitHub for assigned reviews)
   - Task management (create/query/update tasks in a Notion database)
   - Reminders (set and manage reminders, Donna DMs you when they fire)
   - Channel summaries (summarize any Slack channel on demand)
   - Google Calendar (view schedule, create meetings)
   - Mention watch (get DM'd when your name is mentioned in specific channels)

2. Donna asks for setup:
   - Timezone (default: Asia/Kolkata)
   - GitHub username (for PR tracking)
   - Which Slack channels to triage (Donna lists channels user is in, user picks)
   - Notion database: Donna asks user to either share an existing DB or creates a new "Donna Tasks" DB for them. User must add the Notion integration to that DB.
   - Google Calendar: optional — Donna sends OAuth link if user wants calendar features

3. Donna confirms setup and marks onboarding complete.

For casual DMs before onboarding (like "hi" or "what can you do?"), Donna responds conversationally and explains how to get started, but doesn't create a user record or start any background processing.

### Phase 1: Unified Data Layer
- Build all 7 store modules (SQLite-backed, user-scoped)
- Keep old code running alongside (don't delete yet)

### Phase 2: Core Infrastructure
- User registry + onboarding flow
- Permissions module
- OAuth token store (encrypted)
- GitHub integration module (dedicated)
- Google Calendar integration
- Notion cleanup (all raw fetch)

### Phase 3: Router + Handler Extraction
- Extract DM router from app.js
- Extract mention router from app.js
- Move/rewrite all handlers to accept userId
- Extract triage-status and triage-rules from app.js switch
- Create calendar, mention-watch, onboarding handlers
- Rewrite conversation engine (SQLite-backed)
- Slim app.js to ~60 lines

### Phase 4: Multi-User Triage
- Rewrite scheduler: fetch each channel once, apply per-user rules
- Per-user mention watch in sweep
- Multi-user daily summary (each user's configured time)
- Slack OAuth flow for user tokens (mark-as-read)

### Phase 5: New Features (parallel)
- Google Calendar OAuth + query/create
- PR tracking overhaul (see below)
- Mention watch via DM (add/remove/list intents)
- Update intent router for new intents

### PR Tracking — Revised Approach
The Slack `#github-prs` channel is NOT sufficient because:
- PR messages appear when a PR is opened, but reviewer assignment can happen later
- The Slack message doesn't always include the reviewer name

**New approach — GitHub API polling:**
- Cron job runs every 10 minutes
- For each onboarded user with a GitHub username:
  1. Call GitHub API: `GET /search/issues?q=review-requested:{username}+is:pr+is:open`
  2. This returns ALL open PRs where the user is a requested reviewer — regardless of when they were assigned
  3. Upsert each PR into `pr_tracking` table
- This replaces the Slack channel watcher for reviewer detection
- DM-based PR detection stays (user can still forward PRs to Donna)

**On "what PRs need my review?":**
- First, call GitHub API to refresh the list (real-time)
- Remove any PRs that are merged/closed from tracking
- Show remaining with status: `(open, awaiting review)`, `(open, approved)`, `(open, changes requested)`, `(draft)`

**Benefits:**
- Catches reviewer assignments that happen after PR creation
- Catches re-requests after changes
- No dependency on Slack channel message format
- Real-time accuracy when queried

### Notion — Per-User Database Management
- During onboarding, Donna asks the user to either:
  1. Share an existing Notion database URL → Donna stores the DB ID for that user
  2. Or Donna creates a new "Donna Tasks - {username}" database for them
- Each user's `notion_database_id` is stored in the `users` table
- User must manually add the Notion integration ("DIFFAI 2.0") to their database — Donna provides instructions
- Tasks and PRs are stored in SQLite as source of truth, with optional Notion sync per user
- When user creates/updates tasks, both SQLite and their Notion DB are updated

### Phase 6: Cleanup
- Migrate existing data (JSON → SQLite)
- Delete dead code
- Update dependencies
- Update PLAN.md

## Recommended Build Order (keeps bot working throughout)
1. Phase 0 → 2. Phase 1 → 3. Phase 3 handlers → 4. Phase 3 router swap →
5. Phase 2.1-2.2 (user registry) → 6. Phase 4.1 (multi-user triage) →
7. Phase 5.3-5.4 (PR status) → 8. Phase 5.5-5.6 (mention watch) →
9. Phase 2.3+5.1-5.2 (OAuth + Calendar) → 10. Phase 6 (cleanup)

## OAuth Strategy
- **Slack user tokens** (for mark-as-read): Deferred to future scope. For now, only admin's user token is used. When multi-user mark-as-read is needed, will require a public URL (nginx/tunnel on VM).
- **Google Calendar**: Use **Device Flow** (no public URL needed). Donna DMs user: "Go to google.com/device and enter code ABCD-EFGH". Donna polls Google until auth completes. Same approach as CLI tools like `gcloud auth login`.
- **Future**: If/when a public URL is set up (nginx + domain on GCP VM), both Slack and Google can switch to standard OAuth redirect flow.

## Risks
1. **Multi-user triage rate limits** — must fetch each channel once, apply multiple users' rules
2. **Encryption key management** — if ENCRYPTION_KEY lost, all user tokens unrecoverable
3. **PM2 restart during evolve** — works on current VM, needs update for Docker
4. **Google Device Flow** — requires enabling "TVs and Limited Input devices" OAuth client type in Google Cloud Console
