# AGP Trivia — Stress Test

Simulates N concurrent players hitting the Supabase backend to verify the live game will hold up at Gonzaga (expected 75–200 student-athletes).

## Prerequisites

1. **Node.js** installed (any recent LTS — 18 or 20 is fine).
2. **Apply the latest `schema.sql`** in Supabase SQL Editor. The `score_question` RPC function must exist, or scoring will still use the slow path.
3. **Upgrade Supabase to Pro** for the test (and for the live event). Free tier: 2M realtime messages/month, 500 concurrent connections. Pro: 5M/500M, higher connection caps, much more headroom.

## One-time install

```bash
cd Trivia/stress-test
npm install
```

## Running a test

You'll have 3 things going at once:

**Terminal 1** — static server for the trivia app (from the `Trivia/` folder):
```bash
python -m http.server 8765
```

**Browser** — open the host view:
```
http://localhost:8765/host.html?game=gonzaga-2026-04-20
```
(Also open `display.html` in another tab if you want to watch the leaderboard.)

**Terminal 2** — the simulator:
```bash
cd Trivia/stress-test
node simulate.js --count 100
```

Once all 100 fake players have joined (you'll see the lobby counter climb), click **Start Game** in the host tab. The simulator will auto-answer each question as it fires. You drive the game flow: **Close → Show Results → Next → …**

Hit **Ctrl-C** in Terminal 2 when done to see the final report.

## Flags

| Flag | Default | Description |
|---|---|---|
| `--count N` | 100 | Number of fake players |
| `--game ID` | `gonzaga-2026-04-20` | Which game to join |
| `--correct 0.0–1.0` | 0.7 | Probability a fake player picks the right answer |
| `--change 0.0–1.0` | 0.15 | Probability a player changes their answer once, 2–5s after first pick |
| `--repick 0.0–1.0` | 0.25 | Probability a wrong-picker repicks at each elimination hint (10s + 5s remaining) |

## What to watch for

- **Join latency p95 > 2000 ms** → DB is straining on writes. Check Supabase dashboard.
- **Answer failures > 0** → likely rate-limiting or connection drops. Consider batch size.
- **Scoring time (measured in host browser console)** → should be < 2s for any N. If it's taking 10–30s, the RPC isn't being used — re-check that `schema.sql` was applied.
- **Supabase Dashboard → Realtime → Messages**: watch the rate. With the fanout fix in play.js, ~200 players should emit roughly 15–30k messages per full game.

## Recommended test sequence

1. **10 players** — sanity check that everything works end-to-end.
2. **50 players** — catches most real-world scaling issues.
3. **150 players** — the typical Gonzaga expected attendance.
4. **250 players** — safety margin over the expected max.

If 250 passes cleanly, 200 on game day will be fine.

## Cleaning up after a test

The host page has a **Reset Game** button that wipes all fake players + answers and puts the game back in the lobby state. Use it between runs.

## Reminder: downgrade Supabase after events

If you're on Pro for a specific school and don't have another event soon, drop back to Free between events. Pro is $25/month; you only need it for the month of any live game.
