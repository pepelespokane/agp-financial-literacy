// Host view — game control, timer, live answer distribution, scoring.

console.log('%chost.js v8 2026-04-21', 'color:#0af;font-weight:bold;');

(function () {
  // Host-key gate. Prevents random audience members from loading the control page
  // just by guessing the URL. The QR code for players goes to join.html which has
  // no key requirement, so this is invisible to athletes.
  const HOST_KEY = 'agp-trivia-h0st-9b7f4e2c';
  const urlKey = new URLSearchParams(window.location.search).get('key');
  if (urlKey !== HOST_KEY) {
    document.body.innerHTML = '<main style="padding:60px 20px; text-align:center; font-family:system-ui, sans-serif; color:#1F2A38;"><h1 style="font-size:28px;">Access Restricted</h1><p style="font-size:16px; color:#556677;">This control page requires a valid host key.</p></main>';
    return;
  }

  const { getGameId } = window.AGP;
  const gameId = getGameId();

  // DOM refs — lobby
  const lobbyCard  = document.getElementById('lobby-card');
  const startBtn   = document.getElementById('start-btn');
  const countEl    = document.getElementById('player-count');
  const countInEl  = document.getElementById('player-count-inline');
  const listEl     = document.getElementById('player-list');
  const emptyEl    = document.getElementById('empty-msg');
  const labelEl    = document.getElementById('game-label');

  // DOM refs — question
  const questionCard  = document.getElementById('question-card');
  const qNumber       = document.getElementById('q-number');
  const qTopic        = document.getElementById('q-topic');
  const qText         = document.getElementById('q-text');
  const distList      = document.getElementById('dist-list');
  const explanationEl = document.getElementById('q-explanation');
  const phaseBadge    = document.getElementById('phase-badge');
  const timerEl       = document.getElementById('host-timer-val');
  const timerBar      = document.getElementById('host-timer-bar');

  // DOM refs — controls
  const closeBtn   = document.getElementById('close-btn');
  const resultsBtn = document.getElementById('results-btn');
  const nextBtn    = document.getElementById('next-btn');
  const endBtn     = document.getElementById('end-btn');

  // DOM refs — finished
  const finishedCard = document.getElementById('finished-card');

  // DOM refs — reset
  const resetBtn = document.getElementById('reset-btn');

  // State
  let questions = [];
  let currentQIndex = -1;
  let gameStatus = 'lobby';
  let questionPhase = 'waiting';
  let playerCount = 0;
  let timerInterval = null;
  let questionStartTime = null;

  const LETTERS = ['A', 'B', 'C', 'D'];
  const TOTAL_TIME = 25;

  // ── Load questions ──────────────────────────────────────────────────────
  // Per-game file first (questions-{gameId}.json), fall back to questions.json.
  async function loadQuestions() {
    const v = Date.now();
    let resp = await fetch(`questions-${gameId}.json?v=${v}`, { cache: 'no-store' });
    if (!resp.ok) {
      resp = await fetch('questions.json?v=' + v, { cache: 'no-store' });
    }
    const data = await resp.json();
    questions = data.questions;
  }

  // ── Load game ───────────────────────────────────────────────────────────
  async function loadGame() {
    const { data: game, error } = await sb
      .from('games')
      .select('id,name,status,current_question_id,question_phase,question_started_at')
      .eq('id', gameId)
      .maybeSingle();
    if (error || !game) {
      labelEl.textContent = 'Game not found: ' + gameId;
      return;
    }
    labelEl.textContent = game.name;
    gameStatus = game.status;
    questionPhase = game.question_phase;

    if (game.status === 'active' && game.current_question_id != null) {
      currentQIndex = game.current_question_id - 1;
      questionStartTime = game.question_started_at ? new Date(game.question_started_at).getTime() : null;
      showQuestionCard();
    } else if (game.status === 'finished') {
      showFinished();
    }
  }

  // ── Timer ───────────────────────────────────────────────────────────────

  function startTimer() {
    stopTimer();
    timerInterval = setInterval(updateTimer, 200);
    updateTimer();
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function updateTimer() {
    if (!questionStartTime) return;
    // Defensive clamp — host uses its own local clock so skew isn't expected, but keeps behavior identical across views.
    const elapsed = Math.max(0, (Date.now() - questionStartTime) / 1000);
    const remaining = Math.max(0, TOTAL_TIME - elapsed);
    const secs = Math.ceil(remaining);

    if (timerEl) timerEl.textContent = secs;
    if (timerBar) timerBar.style.width = (remaining / TOTAL_TIME * 100) + '%';

    if (remaining <= 5) {
      timerBar.className = 'timer-bar timer-danger';
    } else if (remaining <= 10) {
      timerBar.className = 'timer-bar timer-warn';
    } else {
      timerBar.className = 'timer-bar';
    }

    // Auto-close
    if (remaining <= 0 && questionPhase === 'answering') {
      stopTimer();
      autoClose();
    }
  }

  async function autoClose() {
    const { error } = await sb
      .from('games')
      .update({ question_phase: 'closed' })
      .eq('id', gameId);
    if (!error) {
      questionPhase = 'closed';
      updateControls();
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  function showQuestionCard() {
    lobbyCard.classList.add('hidden');
    finishedCard.classList.add('hidden');
    questionCard.classList.remove('hidden');

    const q = questions[currentQIndex];
    qNumber.textContent = `Question ${currentQIndex + 1} of ${questions.length}`;
    qTopic.textContent = q.topic;
    qText.textContent = q.question;

    // Build distribution bars
    distList.innerHTML = '';
    q.options.forEach((opt, i) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="dist-letter">${LETTERS[i]}</span>
        <span style="flex:1; font-size:13px; color:var(--text-mid);">${escapeHtml(opt)}</span>
        <span class="dist-bar-wrap"><span class="dist-bar" id="dist-bar-${i}" style="width:0%;"></span></span>
        <span class="dist-count" id="dist-count-${i}">0</span>
      `;
      distList.appendChild(li);
    });

    explanationEl.classList.add('hidden');
    updateControls();
    refreshDistribution();

    if (questionPhase === 'answering') {
      startTimer();
    }
  }

  function updateControls() {
    closeBtn.classList.toggle('hidden', questionPhase !== 'answering');
    resultsBtn.classList.toggle('hidden', questionPhase !== 'closed');
    const isLastQ = currentQIndex >= questions.length - 1;
    nextBtn.classList.toggle('hidden', questionPhase !== 'results' || isLastQ);
    endBtn.classList.toggle('hidden', questionPhase !== 'results');
    explanationEl.classList.toggle('hidden', questionPhase !== 'results');

    phaseBadge.textContent =
      questionPhase === 'answering' ? 'Answering' :
      questionPhase === 'closed' ? 'Closed' :
      questionPhase === 'results' ? 'Results' : questionPhase;
    phaseBadge.className = 'phase-badge phase-' + questionPhase;

    if (questionPhase === 'results') {
      const q = questions[currentQIndex];
      explanationEl.innerHTML = `<strong>Answer: ${LETTERS[q.correct]}</strong> — ${escapeHtml(q.explanation)}`;
      const correctBar = document.getElementById('dist-bar-' + q.correct);
      if (correctBar) correctBar.classList.add('dist-correct');
    }
  }

  function showFinished() {
    lobbyCard.classList.add('hidden');
    questionCard.classList.add('hidden');
    finishedCard.classList.remove('hidden');
    gameStatus = 'finished';
    stopTimer();
  }

  // ── Answer distribution ─────────────────────────────────────────────────

  async function refreshDistribution() {
    if (currentQIndex < 0) return;
    const qId = questions[currentQIndex].id;
    const { data, error } = await sb
      .from('answers')
      .select('answer_index')
      .eq('game_id', gameId)
      .eq('question_id', qId);
    if (error) { console.error(error); return; }

    const counts = [0, 0, 0, 0];
    data.forEach(a => { counts[a.answer_index] = (counts[a.answer_index] || 0) + 1; });
    const max = Math.max(...counts, 1);

    counts.forEach((c, i) => {
      const bar = document.getElementById('dist-bar-' + i);
      const countSpan = document.getElementById('dist-count-' + i);
      if (bar) bar.style.width = (c / max * 100) + '%';
      if (countSpan) countSpan.textContent = c;
    });
  }

  // ── Player list ─────────────────────────────────────────────────────────

  async function refreshPlayers() {
    const { data, error } = await sb
      .from('players')
      .select('id,name,sport,score,joined_at')
      .eq('game_id', gameId)
      .order('score', { ascending: false });
    if (error) { console.error(error); return; }

    // If we have an active question, fetch answers for it to show per-player results
    let answerMap = {}; // player_id → { is_correct, points_earned }
    if (currentQIndex >= 0 && questionPhase === 'results') {
      const qId = questions[currentQIndex].id;
      const { data: answers } = await sb
        .from('answers')
        .select('player_id,is_correct,points_earned')
        .eq('game_id', gameId)
        .eq('question_id', qId);
      if (answers) {
        answers.forEach(a => { answerMap[a.player_id] = a; });
      }
    }

    playerCount = data.length;
    countEl.textContent = playerCount;
    countInEl.textContent = '(' + playerCount + ')';
    listEl.innerHTML = '';
    if (data.length === 0) {
      emptyEl.style.display = '';
      return;
    }
    emptyEl.style.display = 'none';

    data.forEach((p, i) => {
      const li = document.createElement('li');
      const ans = answerMap[p.id];
      let lastQHtml = '';
      if (ans) {
        if (ans.is_correct) {
          lastQHtml = `<span class="last-q last-q-correct">+${formatScore(ans.points_earned)}</span>`;
        } else {
          lastQHtml = `<span class="last-q last-q-wrong">+0</span>`;
        }
      } else if (questionPhase === 'results') {
        lastQHtml = `<span class="last-q last-q-wrong">—</span>`;
      }
      li.innerHTML = `
        <div>
          <span class="prank">${i + 1}</span>
          <span class="pname">${escapeHtml(p.name)}</span>
          <span class="psport">${escapeHtml(p.sport || '')}</span>
        </div>
        <div style="display:flex; align-items:center; gap:12px;">
          ${lastQHtml}
          <span class="pscore">${formatScore(p.score ?? 0)}</span>
        </div>
      `;
      listEl.appendChild(li);
    });
  }

  // ── Game control actions ────────────────────────────────────────────────

  startBtn.addEventListener('click', async () => {
    if (playerCount === 0) {
      alert('No players have joined yet.');
      return;
    }
    startBtn.disabled = true;
    startBtn.textContent = 'Starting…';

    currentQIndex = 0;
    // Host's local timer uses the host's own clock. Phones use the server's
    // question_started_at (set by the RPC below) with their NTP-synced clocks.
    // Do NOT mix the two — server time subtracted from host's drifted clock
    // produces a wildly wrong countdown.
    questionStartTime = Date.now();

    const { error } = await sb.rpc('start_question', {
      p_game_id: gameId,
      p_question_id: questions[0].id,
    });

    if (error) {
      console.error(error);
      alert('Failed to start game.');
      startBtn.disabled = false;
      startBtn.textContent = 'Start Game';
      return;
    }

    gameStatus = 'active';
    questionPhase = 'answering';
    showQuestionCard();
  });

  closeBtn.addEventListener('click', async () => {
    closeBtn.disabled = true;
    stopTimer();
    const { error } = await sb
      .from('games')
      .update({ question_phase: 'closed' })
      .eq('id', gameId);
    closeBtn.disabled = false;
    if (error) { console.error(error); return; }
    questionPhase = 'closed';
    updateControls();
  });

  resultsBtn.addEventListener('click', async () => {
    resultsBtn.disabled = true;
    await scoreCurrentQuestion();
    const { error } = await sb
      .from('games')
      .update({ question_phase: 'results' })
      .eq('id', gameId);
    resultsBtn.disabled = false;
    if (error) { console.error(error); return; }
    questionPhase = 'results';
    updateControls();
    refreshPlayers();
  });

  nextBtn.addEventListener('click', async () => {
    nextBtn.disabled = true;
    currentQIndex++;
    const q = questions[currentQIndex];

    // Host timer uses local clock — same reasoning as Start.
    questionStartTime = Date.now();

    const { error } = await sb.rpc('start_question', {
      p_game_id: gameId,
      p_question_id: q.id,
    });
    if (error) { console.error(error); nextBtn.disabled = false; return; }

    nextBtn.disabled = false;
    questionPhase = 'answering';
    showQuestionCard();
  });

  endBtn.addEventListener('click', async () => {
    if (!confirm('End the game? This will lock final scores.')) return;
    endBtn.disabled = true;
    const { error } = await sb
      .from('games')
      .update({ status: 'finished', question_phase: 'finished' })
      .eq('id', gameId);
    if (error) { console.error(error); endBtn.disabled = false; return; }
    showFinished();
  });

  // ── Reset game (wipe players + answers, return to lobby) ────────────────

  resetBtn.addEventListener('click', async () => {
    const confirmMsg = 'Reset the game? This will:\n\n' +
      '• Remove ALL joined players\n' +
      '• Delete ALL answers and scores\n' +
      '• Return the display to the lobby / QR screen\n\n' +
      'Use this to start fresh before a live event.';
    if (!confirm(confirmMsg)) return;

    resetBtn.disabled = true;
    const originalText = resetBtn.textContent;
    resetBtn.textContent = 'Resetting…';

    try {
      // Order matters because of the FK: delete answers first, then players.
      const delAns = await sb.from('answers').delete().eq('game_id', gameId);
      if (delAns.error) throw delAns.error;

      const delPl = await sb.from('players').delete().eq('game_id', gameId);
      if (delPl.error) throw delPl.error;

      const upd = await sb.from('games')
        .update({
          status: 'lobby',
          current_question_id: null,
          question_phase: 'waiting',
          question_started_at: null,
        })
        .eq('id', gameId);
      if (upd.error) throw upd.error;

      // Reset local host state and UI
      currentQIndex = -1;
      gameStatus = 'lobby';
      questionPhase = 'waiting';
      questionStartTime = null;
      stopTimer();

      finishedCard.classList.add('hidden');
      questionCard.classList.add('hidden');
      lobbyCard.classList.remove('hidden');

      // Re-enable every control button — any of them could have been left
      // disabled by a prior click (e.g. End Game in the previous game).
      [startBtn, closeBtn, resultsBtn, nextBtn, endBtn].forEach(b => { b.disabled = false; });
      startBtn.textContent = 'Start Game';

      refreshPlayers();
    } catch (e) {
      console.error('Reset failed:', e);
      alert('Reset failed: ' + (e.message || e));
    } finally {
      resetBtn.disabled = false;
      resetBtn.textContent = originalText;
    }
  });

  // ── Scoring ─────────────────────────────────────────────────────────────
  // Calls the score_question Postgres function, which does all the per-answer
  // point calculation + per-player score updates in a single round-trip.
  // Safe at 200 players; the old serial loop was not.

  async function scoreCurrentQuestion() {
    const q = questions[currentQIndex];
    const { error } = await sb.rpc('score_question', {
      p_game_id: gameId,
      p_question_id: q.id,
    });
    if (error) console.error('score_question RPC error:', error);
  }

  // ── Realtime ────────────────────────────────────────────────────────────
  // Debounced so a burst of 200 simultaneous inserts/updates collapses into
  // one SELECT, not 200. At scoring time every player row updates nearly
  // simultaneously; undebounced refreshes would hammer the DB.
  function debounce(fn, ms) {
    let t = null;
    return function () {
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; fn(); }, ms);
    };
  }
  const debouncedPlayers      = debounce(refreshPlayers, 250);
  const debouncedDistribution = debounce(refreshDistribution, 200);

  sb.channel('host-players-' + gameId)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'players', filter: `game_id=eq.${gameId}` },
      () => debouncedPlayers())
    .subscribe();

  sb.channel('host-answers-' + gameId)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'answers', filter: `game_id=eq.${gameId}` },
      () => debouncedDistribution())
    .subscribe();

  // If the host tab was backgrounded, browsers throttle setInterval — the timer can
  // stall and autoClose may not fire. Re-check on focus: if time is already up,
  // close immediately; otherwise restart the interval so the countdown keeps moving.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (questionPhase === 'answering' && questionStartTime) {
      const elapsed = (Date.now() - questionStartTime) / 1000;
      if (elapsed >= TOTAL_TIME) {
        stopTimer();
        autoClose();
      } else {
        startTimer();
      }
    }
  });

  // ── Helpers ─────────────────────────────────────────────────────────────

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function formatScore(n) {
    return (n || 0).toLocaleString('en-US');
  }

  // ── Init ────────────────────────────────────────────────────────────────

  loadQuestions().then(() => {
    loadGame();
    refreshPlayers();
  });
})();
