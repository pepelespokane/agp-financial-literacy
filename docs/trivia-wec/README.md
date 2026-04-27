# AGP Live Trivia

A live multiplayer trivia web app built as a companion tool for AGP Financial Literacy presentations. Athletes scan a QR code, enter their name and sport, and answer trivia questions on their phones in real time. Scoring is speed + accuracy. Running leaderboard projected to the room.

First live use: **Gonzaga University Athletics — Monday, April 20, 2026, 6:15 p.m. PT**

## Architecture

- Vanilla HTML / CSS / JS. No build step, no framework.
- **Supabase** (free tier) for realtime sync. Postgres + realtime subscriptions over websockets.
- Static hosting on GitHub Pages as a subdirectory of the main AGP site.
- Four views in one codebase, switched by URL path:
  - `/trivia/join` — player join form (QR code lands here)
  - `/trivia/play` — player answering view
  - `/trivia/host` — Stephen's control view (reveal questions, close, next)
  - `/trivia/display` — projected display (current question + leaderboard)

## Data model

Three tables in Supabase:

- **games** — one row per game session. Holds current question id and phase.
- **players** — joined players (name, sport, running score).
- **answers** — one row per player per question answered.

Questions themselves live client-side in `questions.json`. The host broadcasts "show question #N" via the games table; every client looks up question N in its local copy. Simpler than storing questions in the DB.

## Security note

This app has no auth. Anyone with the game_id can join as any name and submit answers. That is acceptable for a one-time live event with a short-lived game_id that is not publicly indexed. Do **not** reuse this architecture for anything where cheating or impersonation would matter.

## Build timeline

| Day | Goal | Test gate |
|---|---|---|
| Wed 4/15 | Schema, scaffold, join flow | 2 phones can join and appear in the lobby |
| Thu 4/16 | Host controls, question reveal, answer collection, scoring | Push a question from host view, both phones answer it, score updates |
| Fri 4/17 | Leaderboard, display view, polish, branding | End-to-end game runs with 5 questions across 3+ phones |
| Sat 4/18 | **DECISION POINT.** Full rehearsal or pivot to Slido. | Stephen + Steph play a full round on real devices |
| Sun 4/19 | Final polish, deploy, QR code generated, URL tested from outside network | Public URL works |
| Mon 4/20 | Live at 6:15 p.m. PT | |

## Setup

### 1. Supabase project

Created at https://ncwddjohtfjdlebvrmiq.supabase.co. Publishable key stored in `js/supabase-client.js`.

### 2. Run the schema

Open Supabase → SQL Editor → paste the contents of `schema.sql` → Run. This creates the `games`, `players`, and `answers` tables, sets up permissive RLS policies, and enables realtime replication on all three.

### 3. Seed a game

From Supabase → SQL Editor or Table Editor, insert one row into `games`:

```sql
insert into games (id, name, status, question_phase)
values ('gonzaga-2026-04-20', 'Gonzaga - Your Money Playbook', 'lobby', 'waiting');
```

### 4. Open the views

Serve the folder locally (VS Code Live Server, `python -m http.server`, etc.) and open:

- `http://localhost:8000/join.html?game=gonzaga-2026-04-20` — player join
- `http://localhost:8000/host.html?game=gonzaga-2026-04-20` — host control

## Files

```
Trivia/
  README.md                 -- this file
  schema.sql                -- Supabase schema (run this first)
  index.html                -- landing page / router
  join.html                 -- player join form
  play.html                 -- player answering view
  host.html                 -- Stephen's control view
  display.html              -- projected display (QR, question, leaderboard, podium)
  style.css                 -- shared styles
  display.css               -- display-only styles (big screen, dark theme)
  questions.json            -- trivia content (edit this for new events)
  agp-logo-white.png        -- logo used in headers
  js/
    supabase-client.js      -- shared Supabase connection setup
    utils.js                -- small helpers (getGameId, formatScore, etc.)
    join.js                 -- player join logic
    play.js                 -- player answering logic
    host.js                 -- host control logic
    display.js              -- projected display logic (QR + realtime render)
```

## Running a live event

Open four tabs:

1. **Display** (projector): `display.html?game=gonzaga-2026-04-20` — shows QR code and leaderboard
2. **Host** (Stephen): `host.html?game=gonzaga-2026-04-20` — controls the game
3. **Players** (phones): scan the QR code on the display — lands on `join.html`
4. (Optional) Second player phone for testing

Game flow:
- Lobby → players join, display shows QR + names → Host clicks **Start Game**
- For each question: 20s timer (auto-closes) → **Show Results** → **Next Question**
- Last question → **End Game** → display switches to podium
