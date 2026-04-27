// Stress test for v6 production deploy.
// - Joins N fake players (default 50)
// - Auto-drives the host through 3 questions via RPCs (no manual host browser needed)
// - Players answer via the submit_answer RPC (same path as real v6 clients)
// - Tests start_question + submit_answer + score_question + realtime fanout
//
// Run: node stress-v6.js [--count 50] [--questions 3]

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
  }, [])
);
const PLAYER_COUNT = parseInt(args.count || '50', 10);
const NUM_QS       = parseInt(args.questions || '3', 10);
const GAME_ID      = args.game || 'gonzaga-2026-04-20';
const CORRECT_RATE = parseFloat(args.correct || '0.7');
const CHANGE_RATE  = parseFloat(args.change  || '0.15');
const QUESTIONS_PATH = path.resolve(__dirname, '..', 'questions.json');

const SUPABASE_URL = 'https://ncwddjohtfjdlebvrmiq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_AAYrg5863rclvkSMvIaL2A_4-TVl2dE';

const QUESTIONS = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf-8')).questions;

const FIRST_NAMES = ['Alex','Jordan','Taylor','Morgan','Casey','Riley','Cam','Jamie','Reese','Quinn','Drew','Rowan','Parker','Avery','Sam','Devon','Skyler','Kendall','Dakota','Emerson','Nico','Harper','Phoenix','Rory','Sage','Terry','Val','Winter','Bailey','Charlie'];
const SPORTS = ['Basketball','Soccer','Volleyball','Baseball','Softball','Track','XC','Swim','Tennis','Golf'];

const randChoice = a => a[Math.floor(Math.random() * a.length)];
const randFloat  = (lo, hi) => lo + Math.random() * (hi - lo);
const sleep      = ms => new Promise(r => setTimeout(r, ms));

const metrics = {
  joined: 0, joinFail: 0, joinLatenciesMs: [],
  answered: 0, answerFail: 0, answerLatenciesMs: [],
  realtimeEvents: 0,
  hostLatenciesMs: [],
};
function pctile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a,b)=>a-b);
  return s[Math.min(s.length-1, Math.floor(p/100 * s.length))];
}

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
    this.currentQid = null;
    this.answeredQs = new Set();
  }

  async join() {
    const t0 = Date.now();
    const { data, error } = await this.sb
      .from('players')
      .insert({ game_id: GAME_ID, name: this.name, sport: this.sport })
      .select('id')
      .single();
    const dt = Date.now() - t0;
    if (error) { metrics.joinFail++; console.error(`[p${this.i}] join:`, error.message); return false; }
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
          const g = payload.new;
          if (g.status === 'active' && g.question_phase === 'answering'
              && g.current_question_id != null
              && g.current_question_id !== this.currentQid
              && !this.answeredQs.has(g.current_question_id)) {
            this.currentQid = g.current_question_id;
            this.scheduleAnswer(g.current_question_id);
          }
        })
      .subscribe();
  }

  scheduleAnswer(qId) {
    const firstAtSec = (randFloat(1.5, 10) + randFloat(1.5, 8)) / 2;
    setTimeout(() => this.submit(qId, false), Math.round(firstAtSec * 1000));
    if (Math.random() < CHANGE_RATE) {
      const secondAtSec = Math.min(firstAtSec + randFloat(2, 5), 18);
      setTimeout(() => this.submit(qId, true), Math.round(secondAtSec * 1000));
    }
  }

  async submit(qId, isRepick) {
    if (!isRepick && this.answeredQs.has(qId)) return;
    if (this.currentQid !== qId) return;
    this.answeredQs.add(qId);
    const q = QUESTIONS.find(x => x.id === qId);
    if (!q) return;
    const correct = Math.random() < CORRECT_RATE;
    const lastIdx = this.lastPick && this.lastPick.qId === qId ? this.lastPick.idx : null;
    let answerIdx;
    if (correct) {
      answerIdx = q.correct;
    } else {
      const wrongs = [0,1,2,3].filter(i => i !== q.correct && i !== lastIdx);
      answerIdx = randChoice(wrongs.length ? wrongs : [0,1,2,3].filter(i => i !== q.correct));
    }
    this.lastPick = { qId, idx: answerIdx };

    const t0 = Date.now();
    // v6 path: use submit_answer RPC so submitted_at is server-side on each pick.
    const { error } = await this.sb.rpc('submit_answer', {
      p_game_id: GAME_ID,
      p_player_id: this.playerId,
      p_question_id: qId,
      p_answer_index: answerIdx,
      p_is_correct: answerIdx === q.correct,
    });
    const dt = Date.now() - t0;
    if (error) {
      metrics.answerFail++;
      if (metrics.answerFail < 10) console.error(`[p${this.i}] submit_answer:`, error.message);
    } else {
      metrics.answered++;
      metrics.answerLatenciesMs.push(dt);
    }
  }
}

// ── Host driver ────────────────────────────────────────────────────────────
async function driveHost() {
  const host = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function call(name, params) {
    const t0 = Date.now();
    const { error } = await host.rpc(name, params);
    const dt = Date.now() - t0;
    metrics.hostLatenciesMs.push(dt);
    if (error) { console.error(`[host] ${name}:`, error.message); throw error; }
    return dt;
  }

  for (let i = 0; i < NUM_QS; i++) {
    const q = QUESTIONS[i];
    console.log(`\n[host] → start_question id=${q.id} (Q${i+1}/${NUM_QS})`);
    const dt1 = await call('start_question', { p_game_id: GAME_ID, p_question_id: q.id });
    console.log(`[host]   start_question: ${dt1}ms`);

    // Hold the "answering" window for 25s (matches production timer)
    await sleep(25000);

    // Close phase (update directly — no RPC for this)
    await host.from('games').update({ question_phase: 'closed' }).eq('id', GAME_ID);
    await sleep(300);

    // Score + reveal
    const dt2 = await call('score_question', { p_game_id: GAME_ID, p_question_id: q.id });
    console.log(`[host]   score_question: ${dt2}ms`);
    await host.from('games').update({ question_phase: 'results' }).eq('id', GAME_ID);

    // Gap before next
    await sleep(4000);
  }

  // End the game
  await host.from('games').update({ status: 'finished', question_phase: 'finished' }).eq('id', GAME_ID);
  console.log('\n[host] game ended');
}

// ── Reset game before starting ──────────────────────────────────────────────
async function resetGame() {
  const admin = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await admin.from('answers').delete().eq('game_id', GAME_ID);
  await admin.from('players').delete().eq('game_id', GAME_ID);
  await admin.from('games').update({
    status: 'lobby',
    current_question_id: null,
    question_phase: 'waiting',
    question_started_at: null,
  }).eq('id', GAME_ID);
  console.log('Game reset to lobby.');
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== AGP Trivia v6 Stress Test ===');
  console.log(`Target:   agpfinancialliteracy.com/trivia/ (prod)`);
  console.log(`Game:     ${GAME_ID}`);
  console.log(`Players:  ${PLAYER_COUNT}`);
  console.log(`Questions: ${NUM_QS}`);
  console.log(`Questions loaded: ${QUESTIONS.length}\n`);

  await resetGame();

  const players = [];
  for (let i = 0; i < PLAYER_COUNT; i++) players.push(new FakePlayer(i));

  const BATCH = 20;
  for (let start = 0; start < players.length; start += BATCH) {
    const batch = players.slice(start, start + BATCH);
    await Promise.all(batch.map(p => p.join()));
    batch.forEach(p => p.playerId && p.subscribe());
    process.stdout.write(`Joined ${Math.min(start + BATCH, players.length)}/${PLAYER_COUNT}\r`);
    await sleep(150);
  }
  console.log(`\nJoined: ${metrics.joined}  |  Failed: ${metrics.joinFail}`);

  // Wait 2s for realtime subscriptions to all establish
  await sleep(2000);

  // Live metrics every 5s while driving
  const metricsTimer = setInterval(() => {
    console.log(
      `    [metrics] ans=${metrics.answered}/${metrics.answered + metrics.answerFail}` +
      ` ans-p50=${pctile(metrics.answerLatenciesMs, 50)}ms` +
      ` ans-p95=${pctile(metrics.answerLatenciesMs, 95)}ms` +
      ` events=${metrics.realtimeEvents}`
    );
  }, 5000);

  await driveHost();
  clearInterval(metricsTimer);

  // Small tail window for last answers/events
  await sleep(2000);

  console.log('\n=== Final Report ===');
  console.log(`Players:  ${metrics.joined} joined (${metrics.joinFail} failed)`);
  console.log(`  join latency p50/p95/p99: ${pctile(metrics.joinLatenciesMs,50)}/${pctile(metrics.joinLatenciesMs,95)}/${pctile(metrics.joinLatenciesMs,99)}ms`);
  console.log(`Answers:  ${metrics.answered} submitted (${metrics.answerFail} failed)`);
  console.log(`  submit_answer latency p50/p95/p99: ${pctile(metrics.answerLatenciesMs,50)}/${pctile(metrics.answerLatenciesMs,95)}/${pctile(metrics.answerLatenciesMs,99)}ms`);
  console.log(`Host RPCs (start_question + score_question): p50/p95: ${pctile(metrics.hostLatenciesMs,50)}/${pctile(metrics.hostLatenciesMs,95)}ms`);
  console.log(`Realtime events received: ${metrics.realtimeEvents}`);
  console.log(`Expected answers: ${PLAYER_COUNT * NUM_QS} (assuming no repicks counted)`);

  // Also pull actual player scores to verify scoring ran
  const verify = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const { data: scored } = await verify.from('players')
    .select('id,name,score')
    .eq('game_id', GAME_ID)
    .order('score', { ascending: false })
    .limit(5);
  console.log('\nTop 5 final scores:');
  (scored || []).forEach((p, i) => console.log(`  ${i+1}. ${p.name}: ${p.score}`));

  // Check for any 1000-pt outliers that shouldn't exist (shouldn't be possible with v6)
  const { data: answersHot } = await verify.from('answers')
    .select('points_earned,time_to_answer_ms')
    .eq('game_id', GAME_ID)
    .gte('points_earned', 1000);
  console.log(`\nAnswers scored at 1000pts (max): ${(answersHot || []).length} — check time_to_answer_ms below 3000ms only`);
  (answersHot || []).slice(0, 5).forEach(a => console.log(`  pts=${a.points_earned}, ttm=${a.time_to_answer_ms}ms`));

  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
