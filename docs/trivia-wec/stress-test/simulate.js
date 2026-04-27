// AGP Live Trivia — load simulator.
//
// Spawns N fake players, each with its own Supabase client. Each fake player:
//   1. INSERTs a row in `players` (join)
//   2. Subscribes to `games` realtime changes
//   3. When the host advances to a new question (phase='answering'), schedules
//      an answer submission at a realistic random time (1–18s elapsed) with
//      configurable correctness rate.
//
// You manually drive the host (open host.html in a browser) — Start, Close,
// Show Results, Next, End. The simulator logs everything it observes.
//
// Usage:
//   npm install          # first time only
//   node simulate.js [--count 100] [--game gonzaga-2026-04-20] [--correct 0.7]
//
// Defaults: 100 players, Gonzaga game, 70% correctness.

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// ── CLI args ────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
  }, [])
);
const PLAYER_COUNT   = parseInt(args.count || '100', 10);
const GAME_ID        = args.game || 'gonzaga-2026-04-20';
const CORRECT_RATE   = parseFloat(args.correct || '0.7');
const CHANGE_RATE    = parseFloat(args.change  || '0.15'); // P(player changes their mind once)
const REPICK_RATE    = parseFloat(args.repick  || '0.25'); // P(wrong-picker repicks when an elimination "hint" would fire)
const QUESTIONS_PATH = path.resolve(__dirname, '..', 'questions.json');

const SUPABASE_URL = 'https://ncwddjohtfjdlebvrmiq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_AAYrg5863rclvkSMvIaL2A_4-TVl2dE';

// ── Sample data ─────────────────────────────────────────────────────────────
const FIRST_NAMES = [
  'Alex','Jordan','Taylor','Morgan','Casey','Riley','Cam','Jamie','Reese','Quinn',
  'Drew','Rowan','Parker','Avery','Sam','Devon','Skyler','Kendall','Dakota','Emerson',
  'Nico','Harper','Phoenix','Rory','Sage','Terry','Val','Winter','Bailey','Charlie',
  'Ellis','Frankie','Hayden','Indigo','Kai','Logan','Micah','Peyton','River','Shiloh',
];
const SPORTS = ['Basketball','Soccer','Volleyball','Baseball','Softball','Track','XC','Swim','Tennis','Golf','Rowing','Football'];

function randChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(lo, hi)  { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
function randFloat(lo, hi){ return lo + Math.random() * (hi - lo); }
function sleep(ms)        { return new Promise(r => setTimeout(r, ms)); }

// ── Load questions ──────────────────────────────────────────────────────────
let QUESTIONS = [];
try {
  const raw = fs.readFileSync(QUESTIONS_PATH, 'utf-8');
  QUESTIONS = JSON.parse(raw).questions;
  console.log(`Loaded ${QUESTIONS.length} questions.`);
} catch (e) {
  console.error('Failed to load questions.json:', e.message);
  process.exit(1);
}

function questionById(id) {
  return QUESTIONS.find(q => q.id === id);
}

// ── Global metrics ──────────────────────────────────────────────────────────
const metrics = {
  joined: 0,
  joinFail: 0,
  joinLatenciesMs: [],
  answered: 0,
  answerFail: 0,
  answerLatenciesMs: [],
  realtimeEvents: 0,
  startedAt: Date.now(),
};

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// ── Fake player ─────────────────────────────────────────────────────────────
class FakePlayer {
  constructor(i) {
    this.i = i;
    this.name = `${randChoice(FIRST_NAMES)} ${String.fromCharCode(65 + (i % 26))}${i}`;
    this.sport = randChoice(SPORTS);
    this.sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 10 } },
    });
    this.playerId = null;
    this.currentQuestionId = null;
    this.answeredThisQ = new Set();
  }

  async join() {
    const t0 = Date.now();
    const { data, error } = await this.sb
      .from('players')
      .insert({ game_id: GAME_ID, name: this.name, sport: this.sport })
      .select('id')
      .single();
    const dt = Date.now() - t0;
    if (error) {
      metrics.joinFail++;
      console.error(`[p${this.i}] join error:`, error.message);
      return false;
    }
    this.playerId = data.id;
    metrics.joined++;
    metrics.joinLatenciesMs.push(dt);
    return true;
  }

  subscribe() {
    this.sb.channel('sim-game-' + this.i)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${GAME_ID}` },
        (payload) => {
          metrics.realtimeEvents++;
          this.handleGame(payload.new);
        })
      .subscribe();
  }

  handleGame(game) {
    if (game.status === 'active'
        && game.question_phase === 'answering'
        && game.current_question_id != null
        && game.current_question_id !== this.currentQuestionId
        && !this.answeredThisQ.has(game.current_question_id)) {
      this.currentQuestionId = game.current_question_id;
      this.scheduleAnswer(game.current_question_id, game.question_started_at);
    }
  }

  scheduleAnswer(qId, startedAt) {
    // Realistic human timing: most answers 3-12s, some quick, some slow.
    // Bell-ish via sum of two uniforms.
    const firstPickSec = (randFloat(1.5, 10) + randFloat(1.5, 8)) / 2;
    setTimeout(() => this.submitAnswer(qId, /*isRepick=*/false), Math.round(firstPickSec * 1000));

    // Mind-changer: 15% chance player changes their answer 2-5s later.
    if (Math.random() < CHANGE_RATE) {
      const changeAtSec = Math.min(firstPickSec + randFloat(2, 5), 19);
      setTimeout(() => this.submitAnswer(qId, /*isRepick=*/true), Math.round(changeAtSec * 1000));
    }

    // Elimination-driven repicks: if they picked wrong, the UI fades one wrong
    // answer at 10s remaining and another at 5s remaining. 25% chance a
    // wrong-picker repicks on each hint. These fire at ~10s elapsed and ~15s
    // elapsed (since TOTAL_TIME=20).
    if (Math.random() < REPICK_RATE) setTimeout(() => this.maybeRepick(qId), 10100);
    if (Math.random() < REPICK_RATE) setTimeout(() => this.maybeRepick(qId), 15100);
  }

  async submitAnswer(qId, isRepick) {
    if (!isRepick && this.answeredThisQ.has(qId)) return;
    if (this.currentQuestionId !== qId) return; // question moved on
    this.answeredThisQ.add(qId);

    const q = questionById(qId);
    if (!q) return;

    const correct = Math.random() < CORRECT_RATE;
    const lastPickIdx = this.lastPick && this.lastPick.qId === qId ? this.lastPick.idx : null;
    let answerIndex;
    if (correct) {
      answerIndex = q.correct;
    } else {
      // Don't re-pick the same wrong answer if changing mind.
      const wrongs = [0, 1, 2, 3].filter(i => i !== q.correct && i !== lastPickIdx);
      answerIndex = randChoice(wrongs.length ? wrongs : [0, 1, 2, 3].filter(i => i !== q.correct));
    }
    this.lastPick = { qId, idx: answerIndex };

    const t0 = Date.now();
    const { error } = await this.sb
      .from('answers')
      .upsert({
        game_id: GAME_ID,
        player_id: this.playerId,
        question_id: qId,
        answer_index: answerIndex,
        is_correct: answerIndex === q.correct,
        points_earned: 0,
        submitted_at: new Date().toISOString(),
      }, { onConflict: 'game_id,player_id,question_id' });
    const dt = Date.now() - t0;
    if (error) {
      metrics.answerFail++;
      if (metrics.answerFail < 5) console.error(`[p${this.i}] answer error:`, error.message);
    } else {
      metrics.answered++;
      metrics.answerLatenciesMs.push(dt);
    }
  }

  maybeRepick(qId) {
    // Only repick if the player currently has a wrong answer and the question
    // is still live. Approximates "elimination just faded my pick" behavior.
    if (this.currentQuestionId !== qId) return;
    if (!this.lastPick || this.lastPick.qId !== qId) return;
    const q = questionById(qId);
    if (!q || this.lastPick.idx === q.correct) return;
    this.submitAnswer(qId, /*isRepick=*/true);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== AGP Trivia Stress Test ===');
  console.log(`Game:             ${GAME_ID}`);
  console.log(`Players:          ${PLAYER_COUNT}`);
  console.log(`Correct rate:     ${(CORRECT_RATE * 100).toFixed(0)}%`);
  console.log(`Questions loaded: ${QUESTIONS.length}`);
  console.log('');
  console.log('Start the host now (click Start Game in host.html).');
  console.log('The sim will auto-answer each question as it fires.');
  console.log('');

  const players = [];
  for (let i = 0; i < PLAYER_COUNT; i++) players.push(new FakePlayer(i));

  // Join in staggered waves of 25 at a time to avoid spiky DB writes on startup.
  const BATCH = 25;
  for (let start = 0; start < players.length; start += BATCH) {
    const batch = players.slice(start, start + BATCH);
    await Promise.all(batch.map(p => p.join()));
    batch.forEach(p => p.playerId && p.subscribe());
    process.stdout.write(`Joined ${Math.min(start + BATCH, players.length)}/${PLAYER_COUNT}\r`);
    await sleep(150);
  }
  console.log(`\nJoined: ${metrics.joined}  |  Failed: ${metrics.joinFail}`);
  console.log('Waiting for host to start game…\n');

  // Print live metrics every 3s
  setInterval(() => {
    const elapsed = ((Date.now() - metrics.startedAt) / 1000).toFixed(0);
    console.log(
      `[${elapsed}s] joins=${metrics.joined}(fail=${metrics.joinFail}) ` +
      `answers=${metrics.answered}(fail=${metrics.answerFail}) ` +
      `events=${metrics.realtimeEvents} ` +
      `answer-p50=${percentile(metrics.answerLatenciesMs, 50)}ms ` +
      `answer-p95=${percentile(metrics.answerLatenciesMs, 95)}ms`
    );
  }, 3000);

  // Graceful shutdown on Ctrl-C
  process.on('SIGINT', () => {
    console.log('\n\n=== Final report ===');
    console.log(`Joins:          ${metrics.joined} ok, ${metrics.joinFail} fail`);
    console.log(`  latency ms:   p50=${percentile(metrics.joinLatenciesMs, 50)} p95=${percentile(metrics.joinLatenciesMs, 95)} p99=${percentile(metrics.joinLatenciesMs, 99)}`);
    console.log(`Answers:        ${metrics.answered} ok, ${metrics.answerFail} fail`);
    console.log(`  latency ms:   p50=${percentile(metrics.answerLatenciesMs, 50)} p95=${percentile(metrics.answerLatenciesMs, 95)} p99=${percentile(metrics.answerLatenciesMs, 99)}`);
    console.log(`Realtime events received: ${metrics.realtimeEvents}`);
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
