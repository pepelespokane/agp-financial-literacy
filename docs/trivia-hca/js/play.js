// Player view — lobby, questions, countdown, answer elimination, scoring.

console.log('%cplay.js v8 2026-04-21', 'color:#0af;font-weight:bold;');

(function () {
  const { getGameId, loadPlayerSession, formatScore } = window.AGP;

  const session = loadPlayerSession();
  const gameId = getGameId();

  if (!session || session.game_id !== gameId) {
    window.location.href = 'join.html' + window.location.search;
    return;
  }

  const playerId = session.player_id;

  // DOM refs
  const waitingCard    = document.getElementById('waiting-card');
  const questionCard   = document.getElementById('question-card');
  const finishedCard   = document.getElementById('finished-card');
  const scoreBar       = document.getElementById('score-bar');
  const scoreName      = document.getElementById('score-name');
  const scoreVal       = document.getElementById('score-val');
  const rankEl         = document.getElementById('rank-val');
  const countEl        = document.getElementById('player-count');
  const greetEl        = document.getElementById('greeting');
  const qNumber        = document.getElementById('q-number');
  const qTopic         = document.getElementById('q-topic');
  const qText          = document.getElementById('q-text');
  const answerGrid     = document.getElementById('answer-grid');
  const timerEl        = document.getElementById('timer-val');
  const timerBar       = document.getElementById('timer-bar');
  const pointsAvailEl  = document.getElementById('points-avail');
  const resultsSection = document.getElementById('results-section');
  const pointsFlash    = document.getElementById('points-flash');
  const explanationEl  = document.getElementById('q-explanation');
  const finalScoreEl   = document.getElementById('final-score');

  // State
  let questions = [];
  let currentScore = 0;
  let currentQId = null;
  let selectedOriginalIndex = null; // original (un-shuffled) index of current pick
  let shuffleMap = [];              // shuffleMap[displayPos] = originalIndex
  let timerInterval = null;
  let questionStartTime = null;
  let eliminated = [];              // display indices that have been eliminated
  let timeClosed = false;           // has the 20s expired?

  const LETTERS = ['A', 'B', 'C', 'D'];
  const TOTAL_TIME = 25;

  // ── Point decay ─────────────────────────────────────────────────────────
  // 0-8s: 1000 (reading window) | 8-15s: 1000→500 | 15-20s: 500→250 | 20-25s: 250→1
  function pointsForElapsed(seconds) {
    if (seconds <= 8)  return 1000;
    if (seconds <= 15) return Math.round(1000 - (seconds - 8) * (500 / 7));
    if (seconds <= 20) return Math.round(500 - (seconds - 15) * (250 / 5));
    if (seconds <= 25) return Math.round(250 - (seconds - 20) * (249 / 5));
    return 0;
  }

  // ── Shuffle ─────────────────────────────────────────────────────────────
  // Disabled: in a live group setting, everyone should see the same A/B/C/D
  // ordering as the projector and the host, so "the answer is B" on-stage
  // means B on every phone. Returns identity mapping.
  function shuffleOptions(options, correctOriginal) {
    const indices = options.map((_, i) => i);
    return {
      shuffled: options.slice(),
      map: indices,
      correctDisplay: correctOriginal,
    };
  }

  // ── Init ────────────────────────────────────────────────────────────────

  greetEl.textContent = `Hi, ${session.name}!`;
  scoreName.textContent = session.name;

  async function init() {
    // Cache-bust so a stale questions.json doesn't produce wrong is_correct values.
    // Per-game file first (questions-{gameId}.json), fall back to questions.json.
    const v = Date.now();
    let resp = await fetch(`questions-${gameId}.json?v=${v}`, { cache: 'no-store' });
    if (!resp.ok) {
      resp = await fetch('questions.json?v=' + v, { cache: 'no-store' });
    }
    const data = await resp.json();
    questions = data.questions;

    const { data: player } = await sb
      .from('players')
      .select('score')
      .eq('id', playerId)
      .single();
    if (player) {
      currentScore = player.score || 0;
      scoreVal.textContent = formatScore(currentScore);
    }

    const { data: game } = await sb
      .from('games')
      .select('status,current_question_id,question_phase,question_started_at')
      .eq('id', gameId)
      .single();

    if (game) handleGameState(game);
    refreshCount();
    refreshRank();
  }

  // ── Game state handler ──────────────────────────────────────────────────

  function handleGameState(game) {
    if (game.status === 'finished') {
      stopTimer();
      showFinished();
      return;
    }

    if (game.status === 'active' && game.current_question_id != null) {
      const newQ = game.current_question_id !== currentQId;
      currentQId = game.current_question_id;
      const q = questions.find(q => q.id === currentQId);
      if (!q) return;

      scoreBar.classList.remove('hidden');

      // On a new question (including page reload mid-game), always build the UI first.
      // Then if we're past the answering phase, apply the appropriate end-of-phase state.
      if (newQ) {
        showQuestion(q, game.question_started_at);
      } else if (game.question_phase === 'answering' && !timerInterval) {
        // Same question still running but our timer stopped (tab was backgrounded
        // and setInterval was throttled). Resume the countdown from the server's
        // question_started_at so elapsed time stays authoritative.
        if (game.question_started_at) {
          questionStartTime = new Date(game.question_started_at).getTime();
        }
        startTimer(q);
      }

      if (game.question_phase === 'closed') {
        stopTimer();
        disableAllButtons();
      } else if (game.question_phase === 'results') {
        stopTimer();
        showResults(q);
      }
      // 'answering' is handled by showQuestion (when newQ) or the resume-branch above
    } else {
      showWaiting();
    }
  }

  // ── Views ───────────────────────────────────────────────────────────────

  function showWaiting() {
    waitingCard.classList.remove('hidden');
    questionCard.classList.add('hidden');
    finishedCard.classList.add('hidden');
    scoreBar.classList.add('hidden');
  }

  function showQuestion(q, startedAt) {
    waitingCard.classList.add('hidden');
    finishedCard.classList.add('hidden');
    questionCard.classList.remove('hidden');
    resultsSection.classList.add('hidden');

    // Reset state
    selectedOriginalIndex = null;
    eliminated = [];
    timeClosed = false;

    qNumber.textContent = `Question ${questions.indexOf(q) + 1} of ${questions.length}`;
    qTopic.textContent = q.topic;
    qText.textContent = q.question;

    // Shuffle
    const { shuffled, map, correctDisplay } = shuffleOptions(q.options, q.correct);
    shuffleMap = map;

    // Build answer buttons FIRST so they appear immediately. The existing-answer
    // check runs in the background below — a slow DB response shouldn't delay
    // the UI. This was the "question text changed but answers didn't" bug.
    answerGrid.innerHTML = '';
    shuffled.forEach((opt, displayIdx) => {
      const btn = document.createElement('button');
      btn.className = 'answer-btn';
      btn.id = 'ans-' + displayIdx;
      btn.innerHTML = `<span class="letter">${LETTERS[displayIdx]}</span><span>${escapeHtml(opt)}</span>`;
      btn.dataset.displayIndex = displayIdx;
      btn.addEventListener('click', () => pickAnswer(q, displayIdx));
      answerGrid.appendChild(btn);
    });

    // Start timer immediately — don't wait on network.
    questionStartTime = startedAt ? new Date(startedAt).getTime() : Date.now();
    startTimer(q);

    // Background: if we already answered this Q (e.g. we reloaded), mark the button.
    sb.from('answers')
      .select('answer_index')
      .eq('game_id', gameId)
      .eq('player_id', playerId)
      .eq('question_id', q.id)
      .maybeSingle()
      .then(({ data: existing }) => {
        if (!existing || currentQId !== q.id) return;
        selectedOriginalIndex = existing.answer_index;
        answerGrid.querySelectorAll('.answer-btn').forEach((btn, i) => {
          if (map[i] === existing.answer_index) btn.classList.add('selected');
        });
      });
  }

  function pickAnswer(q, displayIdx) {
    if (timeClosed) return;
    if (eliminated.includes(displayIdx)) return;

    const originalIdx = shuffleMap[displayIdx];

    // Update button visuals — selected, with a "saving" indicator
    answerGrid.querySelectorAll('.answer-btn').forEach((btn, i) => {
      btn.classList.toggle('selected', i === displayIdx);
      if (i !== displayIdx) {
        btn.classList.remove('saving', 'saved', 'save-failed');
      }
    });
    const selectedBtn = document.getElementById('ans-' + displayIdx);
    if (selectedBtn) {
      selectedBtn.classList.add('saving');
      selectedBtn.classList.remove('saved', 'save-failed');
    }

    selectedOriginalIndex = originalIdx;

    // Call the submit_answer RPC with retry-on-failure. Each tap fires a fresh
    // attempt — if the player taps a different answer mid-retry, the new tap
    // wins (selectedOriginalIndex check at line 318ish guards stale callbacks).
    const isCorrect = originalIdx === q.correct;
    submitAnswerWithRetry(q.id, originalIdx, isCorrect, displayIdx, 3);
  }

  function submitAnswerWithRetry(questionId, originalIdx, isCorrect, displayIdx, attemptsLeft) {
    sb.rpc('submit_answer', {
      p_game_id: gameId,
      p_player_id: playerId,
      p_question_id: questionId,
      p_answer_index: originalIdx,
      p_is_correct: isCorrect,
    }).then(({ error }) => {
      // If the player has since changed their pick (or moved past this Q), bail.
      if (currentQId !== questionId || selectedOriginalIndex !== originalIdx) {
        return;
      }
      const btn = document.getElementById('ans-' + displayIdx);
      if (error) {
        console.error('submit_answer RPC error:', error, 'attempts left:', attemptsLeft - 1);
        if (attemptsLeft > 1) {
          setTimeout(() => submitAnswerWithRetry(questionId, originalIdx, isCorrect, displayIdx, attemptsLeft - 1), 250);
        } else {
          if (btn) {
            btn.classList.remove('saving', 'saved');
            btn.classList.add('save-failed');
          }
          const flash = document.getElementById('points-flash');
          if (flash) {
            flash.textContent = 'Answer save failed: ' + (error.message || 'check connection');
            flash.className = 'points-flash zero';
          }
        }
      } else {
        console.log('Answer saved:', { question_id: questionId, answer_index: originalIdx, is_correct: isCorrect });
        if (btn) {
          btn.classList.remove('saving', 'save-failed');
          btn.classList.add('saved');
        }
      }
    });
  }

  // ── Timer ───────────────────────────────────────────────────────────────

  function startTimer(q) {
    stopTimer();
    updateTimerDisplay(q);
    timerInterval = setInterval(() => updateTimerDisplay(q), 200);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function updateTimerDisplay(q) {
    // Clamp to 0 — host's clock may be ahead of the phone's, which would otherwise
    // produce a negative elapsed and a "remaining" greater than TOTAL_TIME.
    const elapsed = Math.max(0, (Date.now() - questionStartTime) / 1000);
    const remaining = Math.max(0, TOTAL_TIME - elapsed);
    const secs = Math.ceil(remaining);

    timerEl.textContent = secs;
    timerBar.style.width = (remaining / TOTAL_TIME * 100) + '%';

    // Color shifts
    if (remaining <= 5) {
      timerBar.className = 'timer-bar timer-danger';
    } else if (remaining <= 10) {
      timerBar.className = 'timer-bar timer-warn';
    } else {
      timerBar.className = 'timer-bar';
    }

    // Points available
    const pts = pointsForElapsed(elapsed);
    if (pointsAvailEl) pointsAvailEl.textContent = pts + ' pts';

    // Eliminate wrong answers
    eliminateAt(q, elapsed);

    // Auto-close
    if (remaining <= 0 && !timeClosed) {
      timeClosed = true;
      stopTimer();
      disableAllButtons();
      if (pointsAvailEl) pointsAvailEl.textContent = '0 pts';
    }
  }

  function eliminateAt(q, elapsed) {
    const remaining = TOTAL_TIME - elapsed;
    const correctDisplay = shuffleMap.indexOf(q.correct);

    // Get wrong display indices (not already eliminated)
    const wrongDisplayIndices = shuffleMap
      .map((origIdx, displayIdx) => ({ displayIdx, origIdx }))
      .filter(x => x.origIdx !== q.correct && !eliminated.includes(x.displayIdx))
      .map(x => x.displayIdx);

    // At 10s remaining → eliminate one wrong answer
    if (remaining <= 10 && eliminated.length === 0 && wrongDisplayIndices.length > 0) {
      const victim = wrongDisplayIndices[0];
      eliminated.push(victim);
      fadeOutAnswer(victim);
      if (selectedOriginalIndex === shuffleMap[victim]) {
        selectedOriginalIndex = null;
        clearSelection();
      }
    }

    // At 5s remaining → eliminate another wrong answer
    if (remaining <= 5 && eliminated.length === 1 && wrongDisplayIndices.length > 0) {
      const victim = wrongDisplayIndices[0];
      eliminated.push(victim);
      fadeOutAnswer(victim);
      if (selectedOriginalIndex === shuffleMap[victim]) {
        selectedOriginalIndex = null;
        clearSelection();
      }
    }
  }

  function fadeOutAnswer(displayIdx) {
    const btn = document.getElementById('ans-' + displayIdx);
    if (btn) {
      btn.classList.add('eliminated');
      btn.disabled = true;
    }
  }

  function clearSelection() {
    answerGrid.querySelectorAll('.answer-btn').forEach(btn => {
      btn.classList.remove('selected');
    });
  }

  function disableAllButtons() {
    answerGrid.querySelectorAll('.answer-btn').forEach(btn => {
      btn.disabled = true;
    });
  }

  // ── Results ─────────────────────────────────────────────────────────────

  async function showResults(q) {
    stopTimer();
    disableAllButtons();
    resultsSection.classList.remove('hidden');

    const correctDisplay = shuffleMap.indexOf(q.correct);

    // Color buttons
    answerGrid.querySelectorAll('.answer-btn').forEach((btn, i) => {
      btn.classList.remove('selected');
      if (eliminated.includes(i)) return; // already faded
      if (shuffleMap[i] === q.correct) {
        btn.classList.add('correct');
      } else if (shuffleMap[i] === selectedOriginalIndex && selectedOriginalIndex !== q.correct) {
        btn.classList.add('incorrect');
      }
    });

    // Also show the correct one even if it was somehow not visible
    const correctBtn = document.getElementById('ans-' + correctDisplay);
    if (correctBtn) {
      correctBtn.classList.remove('eliminated');
      correctBtn.disabled = false;
      correctBtn.classList.add('correct');
    }

    // Get our answer from DB for points
    const { data: ans } = await sb
      .from('answers')
      .select('points_earned,is_correct')
      .eq('game_id', gameId)
      .eq('player_id', playerId)
      .eq('question_id', q.id)
      .maybeSingle();

    const points = ans?.points_earned || 0;
    if (ans?.is_correct) {
      pointsFlash.textContent = '+' + formatScore(points);
      pointsFlash.className = 'points-flash';
    } else if (selectedOriginalIndex != null) {
      pointsFlash.textContent = '+0';
      pointsFlash.className = 'points-flash zero';
    } else {
      pointsFlash.textContent = 'No answer';
      pointsFlash.className = 'points-flash zero';
    }

    explanationEl.innerHTML = `<strong>${LETTERS[correctDisplay]}:</strong> ${escapeHtml(q.explanation)}`;

    refreshScore();
    refreshRank();
  }

  function showFinished() {
    waitingCard.classList.add('hidden');
    questionCard.classList.add('hidden');
    finishedCard.classList.remove('hidden');
    scoreBar.classList.remove('hidden');
    finalScoreEl.textContent = formatScore(currentScore);
    refreshScore();
    refreshRank();
  }

  // ── Refresh helpers ─────────────────────────────────────────────────────

  async function refreshCount() {
    const { count, error } = await sb
      .from('players')
      .select('id', { count: 'exact', head: true })
      .eq('game_id', gameId);
    if (!error) countEl.textContent = count ?? 0;
  }

  async function refreshScore() {
    const { data: player } = await sb
      .from('players')
      .select('score')
      .eq('id', playerId)
      .single();
    if (player) {
      currentScore = player.score || 0;
      scoreVal.textContent = formatScore(currentScore);
      finalScoreEl.textContent = formatScore(currentScore);
    }
  }

  async function refreshRank() {
    if (!rankEl) return;
    const { data, error } = await sb
      .from('players')
      .select('id,score')
      .eq('game_id', gameId)
      .order('score', { ascending: false });
    if (error || !data) return;
    const idx = data.findIndex(p => p.id === playerId);
    if (idx >= 0) {
      rankEl.textContent = ordinal(idx + 1);
    }
  }

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // ── Realtime ────────────────────────────────────────────────────────────

  sb.channel('play-game-' + gameId)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
      (payload) => handleGameState(payload.new))
    .subscribe();

  // Mobile tab backgrounding can pause the realtime websocket and miss events.
  // When the tab becomes visible again, re-fetch game state so we catch up.
  async function resyncGameState() {
    const { data: game } = await sb
      .from('games')
      .select('status,current_question_id,question_phase,question_started_at')
      .eq('id', gameId)
      .single();
    if (game) handleGameState(game);
  }

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    await resyncGameState();
    refreshScore();
    refreshRank();
  });

  // Low-frequency poll as a safety net for missed realtime events. Only fires
  // when the tab is visible — saves bandwidth on sleeping phones.
  setInterval(() => {
    if (document.visibilityState === 'visible') resyncGameState();
  }, 3000);

  // INSERT-only: we just want the lobby count to tick up as players join.
  // Subscribing to '*' would also fan out every score UPDATE to every player,
  // which at 200+ players is O(n²) realtime messages per scored question.
  sb.channel('play-players-' + gameId)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'players', filter: `game_id=eq.${gameId}` },
      () => refreshCount())
    .subscribe();

  // ── Helpers ─────────────────────────────────────────────────────────────

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  init();
})();
