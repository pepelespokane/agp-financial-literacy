// Player view — lobby, questions, countdown, answer elimination, scoring.

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
  const TOTAL_TIME = 20;

  // ── Point decay ─────────────────────────────────────────────────────────
  // 0-3s: 1000 | 3-10s: 1000→500 | 10-15s: 500→250 | 15-20s: 250→1
  function pointsForElapsed(seconds) {
    if (seconds <= 3)  return 1000;
    if (seconds <= 10) return Math.round(1000 - (seconds - 3) * (500 / 7));
    if (seconds <= 15) return Math.round(500 - (seconds - 10) * (250 / 5));
    if (seconds <= 20) return Math.round(250 - (seconds - 15) * (249 / 5));
    return 0;
  }

  // ── Shuffle ─────────────────────────────────────────────────────────────
  // Returns { shuffled: [...options], map: [origIdx, ...], correctDisplay: N }
  function shuffleOptions(options, correctOriginal) {
    const indices = options.map((_, i) => i);
    // Fisher-Yates
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return {
      shuffled: indices.map(i => options[i]),
      map: indices, // map[displayPos] = originalIndex
      correctDisplay: indices.indexOf(correctOriginal),
    };
  }

  // ── Init ────────────────────────────────────────────────────────────────

  greetEl.textContent = `Hi, ${session.name}!`;
  scoreName.textContent = session.name;

  async function init() {
    const resp = await fetch('questions.json');
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
      }

      if (game.question_phase === 'closed') {
        stopTimer();
        disableAllButtons();
      } else if (game.question_phase === 'results') {
        stopTimer();
        showResults(q);
      }
      // 'answering' is handled by showQuestion (when newQ) or left alone (same Q still running)
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

  async function showQuestion(q, startedAt) {
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

    // Check if already answered
    const { data: existing } = await sb
      .from('answers')
      .select('answer_index')
      .eq('game_id', gameId)
      .eq('player_id', playerId)
      .eq('question_id', q.id)
      .maybeSingle();

    if (existing) {
      selectedOriginalIndex = existing.answer_index;
    }

    // Build answer buttons
    answerGrid.innerHTML = '';
    shuffled.forEach((opt, displayIdx) => {
      const btn = document.createElement('button');
      btn.className = 'answer-btn';
      btn.id = 'ans-' + displayIdx;
      btn.innerHTML = `<span class="letter">${LETTERS[displayIdx]}</span><span>${escapeHtml(opt)}</span>`;
      btn.dataset.displayIndex = displayIdx;

      if (selectedOriginalIndex === map[displayIdx]) {
        btn.classList.add('selected');
      }

      btn.addEventListener('click', () => pickAnswer(q, displayIdx));
      answerGrid.appendChild(btn);
    });

    // Start timer
    questionStartTime = startedAt ? new Date(startedAt).getTime() : Date.now();
    startTimer(q);
  }

  function pickAnswer(q, displayIdx) {
    if (timeClosed) return;
    if (eliminated.includes(displayIdx)) return;

    const originalIdx = shuffleMap[displayIdx];

    // Update button visuals
    answerGrid.querySelectorAll('.answer-btn').forEach((btn, i) => {
      btn.classList.toggle('selected', i === displayIdx);
    });

    selectedOriginalIndex = originalIdx;

    // Upsert to DB
    const isCorrect = originalIdx === q.correct;
    sb.from('answers')
      .upsert({
        game_id: gameId,
        player_id: playerId,
        question_id: q.id,
        answer_index: originalIdx,
        is_correct: isCorrect,
        points_earned: 0,
        submitted_at: new Date().toISOString(),
      }, { onConflict: 'game_id,player_id,question_id' })
      .then(({ error }) => {
        if (error) console.error('Answer upsert error:', error);
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
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const { data: game } = await sb
      .from('games')
      .select('status,current_question_id,question_phase,question_started_at')
      .eq('id', gameId)
      .single();
    if (game) handleGameState(game);
    refreshScore();
    refreshRank();
  });

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
