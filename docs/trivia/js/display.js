// Display view — projected screen. Renders QR for joining, big question view,
// live answered count, results distribution, running leaderboard, and final podium.

console.log('%cdisplay.js v5 2026-04-19', 'color:#0af;font-weight:bold;');

(function () {
  const { getGameId, formatScore } = window.AGP;
  const gameId = getGameId();

  // DOM — sections
  const lobbyView    = document.getElementById('lobby-view');
  const gameLayout   = document.getElementById('game-layout');
  const questionView = document.getElementById('question-view');
  const finishedView = document.getElementById('finished-view');
  const leaderboard  = document.getElementById('leaderboard');

  // DOM — lobby
  const qrWrap       = document.getElementById('qr-wrap');
  const lobbyCountEl = document.getElementById('lobby-count');
  const lobbyPlayers = document.getElementById('lobby-players');
  const lobbyEmpty   = document.getElementById('lobby-empty');

  // DOM — question
  const qTopicEl     = document.getElementById('q-topic');
  const qCounterEl   = document.getElementById('q-counter');
  const qTextEl      = document.getElementById('q-text');
  const timerBar     = document.getElementById('d-timer-bar');
  const timerSeconds = document.getElementById('d-timer-seconds');
  const optionsEl    = document.getElementById('d-options');
  const answeredNum  = document.getElementById('d-answered-num');
  const answeredTot  = document.getElementById('d-answered-total');
  const explainEl    = document.getElementById('d-explain');

  // DOM — leaderboard
  const lbList       = document.getElementById('lb-list');

  // DOM — finished
  const podiumEl     = document.getElementById('podium');
  const finalListEl  = document.getElementById('final-list');
  const eventLabel   = document.getElementById('event-label');

  // State
  let questions = [];
  let currentQIndex = -1;
  let currentQId = null;
  let questionPhase = 'waiting';
  let gameStatus = 'lobby';
  let questionStartTime = null;
  let timerInterval = null;
  let lastScores = {}; // player_id → previous score for change highlighting

  const LETTERS = ['A', 'B', 'C', 'D'];
  const TOTAL_TIME = 20;
  const RESULTS_IDLE_MS = 30000;  // 30s in results phase → swap to full leaderboard
  let idleTimer = null;

  // ── Build the join URL used on the QR / screen ────────────────────────
  function buildJoinUrl() {
    const base = window.location.origin + window.location.pathname.replace(/display\.html$/, '');
    const url  = base + 'join.html?game=' + encodeURIComponent(gameId);
    return url;
  }

  function renderQr() {
    const url = buildJoinUrl();
    if (!window.qrcode || !qrWrap) return;
    // type=0 (auto-size), error-correction 'M' (balanced)
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    // cellSize 8 → ~320px wide for typical 40-cell code; margin 2 cells
    qrWrap.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2 });
    const svg = qrWrap.querySelector('svg');
    if (svg) {
      svg.setAttribute('width', '320');
      svg.setAttribute('height', '320');
      svg.style.display = 'block';
    }
  }

  // ── Load questions ────────────────────────────────────────────────────
  async function loadQuestions() {
    const resp = await fetch('questions.json?v=' + Date.now(), { cache: 'no-store' });
    const data = await resp.json();
    questions = data.questions;
    if (data.event && eventLabel) eventLabel.textContent = data.event;
    answeredTot.textContent = questions.length;
  }

  // ── Load game ─────────────────────────────────────────────────────────
  async function loadGame() {
    const { data: game, error } = await sb
      .from('games')
      .select('id,name,status,current_question_id,question_phase,question_started_at')
      .eq('id', gameId)
      .maybeSingle();
    if (error || !game) {
      console.warn('Game not found:', gameId);
      showLobby();
      return;
    }
    applyGame(game);
  }

  function applyGame(game) {
    gameStatus    = game.status;
    questionPhase = game.question_phase;

    if (game.status === 'finished') {
      showFinished();
      return;
    }

    if (game.status === 'active' && game.current_question_id != null) {
      currentQId = game.current_question_id;
      currentQIndex = questions.findIndex(q => q.id === currentQId);
      questionStartTime = game.question_started_at ? new Date(game.question_started_at).getTime() : null;
      showQuestion();
      return;
    }

    showLobby();
  }

  // ── Views ─────────────────────────────────────────────────────────────
  function showLobby() {
    lobbyView.classList.remove('hidden');
    gameLayout.classList.add('hidden');
    gameLayout.classList.remove('full-leaderboard');
    finishedView.classList.add('hidden');
    clearIdleTimer();
    stopTimer();
    renderQr();
    refreshPlayers();
  }

  function showQuestion() {
    lobbyView.classList.add('hidden');
    gameLayout.classList.remove('hidden');
    gameLayout.classList.remove('full-leaderboard');
    finishedView.classList.add('hidden');
    clearIdleTimer();

    const q = questions[currentQIndex];
    if (!q) return;

    qTopicEl.textContent  = q.topic;
    qCounterEl.textContent = `Q${currentQIndex + 1} / ${questions.length}`;
    qTextEl.textContent   = q.question;

    // Build option tiles
    optionsEl.innerHTML = '';
    q.options.forEach((opt, i) => {
      const div = document.createElement('div');
      div.className = 'd-option';
      div.id = 'd-opt-' + i;
      div.innerHTML = `
        <span class="d-letter">${LETTERS[i]}</span>
        <span class="d-text">${escapeHtml(opt)}</span>
        <span class="d-bar" id="d-bar-${i}"></span>
      `;
      optionsEl.appendChild(div);
    });

    explainEl.classList.add('hidden');
    explainEl.innerHTML = '';

    refreshAnswered();
    refreshLeaderboard();

    if (questionPhase === 'answering') {
      startTimer();
    } else if (questionPhase === 'closed') {
      setTimerTo(0);
    } else if (questionPhase === 'results') {
      setTimerTo(0);
      revealResults();
      startIdleTimer();
    }
  }

  function showFinished() {
    lobbyView.classList.add('hidden');
    gameLayout.classList.add('hidden');
    gameLayout.classList.remove('full-leaderboard');
    finishedView.classList.remove('hidden');
    clearIdleTimer();
    stopTimer();
    renderFinal();
  }

  // ── Idle-to-full-leaderboard timer ────────────────────────────────────
  // After 30s in the results phase with no Next Question click, the display
  // swaps the question panel for a full-screen leaderboard. Lets the host
  // present for 5-10 minutes without stale question on screen.
  function startIdleTimer() {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      gameLayout.classList.add('full-leaderboard');
      refreshLeaderboard();
    }, RESULTS_IDLE_MS);
  }
  function clearIdleTimer() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }

  // ── Timer ─────────────────────────────────────────────────────────────
  function startTimer() {
    stopTimer();
    timerInterval = setInterval(updateTimer, 200);
    updateTimer();
  }
  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }
  function setTimerTo(secsRemaining) {
    timerSeconds.textContent = Math.max(0, Math.ceil(secsRemaining));
    timerBar.style.width = (Math.max(0, secsRemaining) / TOTAL_TIME * 100) + '%';
    if (secsRemaining <= 5) timerBar.className = 'd-timer-bar timer-danger';
    else if (secsRemaining <= 10) timerBar.className = 'd-timer-bar timer-warn';
    else timerBar.className = 'd-timer-bar';
  }
  function updateTimer() {
    if (!questionStartTime) return;
    // Clamp elapsed to 0 to protect against clock skew between the host and display machines.
    const elapsed = Math.max(0, (Date.now() - questionStartTime) / 1000);
    const remaining = Math.max(0, TOTAL_TIME - elapsed);
    setTimerTo(remaining);
    if (remaining <= 0) stopTimer();
  }

  // ── Answered count (live) ─────────────────────────────────────────────
  async function refreshAnswered() {
    if (currentQId == null) return;
    const [{ count: answered }, { count: total }] = await Promise.all([
      sb.from('answers').select('id', { count: 'exact', head: true })
        .eq('game_id', gameId).eq('question_id', currentQId),
      sb.from('players').select('id', { count: 'exact', head: true })
        .eq('game_id', gameId),
    ]);
    answeredNum.textContent = answered ?? 0;
    answeredTot.textContent = total ?? 0;
  }

  // ── Results reveal ────────────────────────────────────────────────────
  async function revealResults() {
    const q = questions[currentQIndex];
    if (!q) return;

    const { data: answers } = await sb
      .from('answers')
      .select('answer_index')
      .eq('game_id', gameId)
      .eq('question_id', q.id);

    const counts = [0, 0, 0, 0];
    (answers || []).forEach(a => { counts[a.answer_index] = (counts[a.answer_index] || 0) + 1; });
    const max = Math.max(...counts, 1);

    q.options.forEach((_, i) => {
      const tile = document.getElementById('d-opt-' + i);
      const bar  = document.getElementById('d-bar-' + i);
      if (!tile || !bar) return;
      bar.style.width = (counts[i] / max * 100) + '%';
      if (i === q.correct) {
        tile.classList.add('d-correct');
      } else {
        tile.classList.add('d-dim');
      }
    });

    explainEl.innerHTML = `<strong>${LETTERS[q.correct]}.</strong> ${escapeHtml(q.explanation)}`;
    explainEl.classList.remove('hidden');
  }

  // ── Players / leaderboard ─────────────────────────────────────────────
  async function refreshPlayers() {
    const { data, error } = await sb
      .from('players')
      .select('id,name,sport,score,joined_at')
      .eq('game_id', gameId)
      .order('joined_at', { ascending: true });
    if (error) { console.error(error); return; }

    lobbyCountEl.textContent = data.length;

    // Lobby list — show most recent ~50 chips
    lobbyPlayers.innerHTML = '';
    const recent = data.slice(-50);
    recent.forEach(p => {
      const li = document.createElement('li');
      const sportHtml = p.sport ? `<span class="sport">${escapeHtml(p.sport)}</span>` : '';
      li.innerHTML = `${escapeHtml(p.name)}${sportHtml}`;
      lobbyPlayers.appendChild(li);
    });
    lobbyEmpty.style.display = data.length === 0 ? '' : 'none';
  }

  async function refreshLeaderboard() {
    const { data, error } = await sb
      .from('players')
      .select('id,name,sport,score')
      .eq('game_id', gameId)
      .order('score', { ascending: false })
      .limit(10);
    if (error) { console.error(error); return; }

    const lbTitleEl = document.getElementById('lb-title');
    if (lbTitleEl) {
      lbTitleEl.textContent = data.length >= 10 ? 'Top 10' : `Top ${data.length}`;
    }

    lbList.innerHTML = '';
    data.forEach((p, i) => {
      const changed = lastScores[p.id] != null && lastScores[p.id] !== p.score;
      const li = document.createElement('li');
      if (changed) li.className = 'lb-change';
      li.innerHTML = `
        <span class="lb-rank">${i + 1}</span>
        <span class="lb-name">${escapeHtml(p.name)}</span>
        <span class="lb-score">${formatScore(p.score || 0)}</span>
      `;
      lbList.appendChild(li);
      lastScores[p.id] = p.score || 0;
    });
  }

  // ── Final podium ──────────────────────────────────────────────────────
  async function renderFinal() {
    const { data, error } = await sb
      .from('players')
      .select('id,name,sport,score')
      .eq('game_id', gameId)
      .order('score', { ascending: false });
    if (error) { console.error(error); return; }

    const top3 = data.slice(0, 3);
    const rest = data.slice(3, 5); // ranks 4 and 5 only

    // Podium visual order: 2nd, 1st, 3rd (so 1st is center)
    podiumEl.innerHTML = '';
    const medals = ['gold', 'silver', 'bronze'];
    const visualOrder = [1, 0, 2]; // silver, gold, bronze slots
    visualOrder.forEach(rankIdx => {
      const p = top3[rankIdx];
      if (!p) return;
      const slot = document.createElement('div');
      slot.className = 'podium-slot ' + medals[rankIdx];
      slot.innerHTML = `
        <div class="podium-avatar">${escapeHtml(initials(p.name))}</div>
        <div class="podium-name">${escapeHtml(p.name)}</div>
        <div class="podium-sport">${escapeHtml(p.sport || '')}</div>
        <div class="podium-score">${formatScore(p.score || 0)}</div>
        <div class="podium-block">${rankIdx + 1}</div>
      `;
      podiumEl.appendChild(slot);
    });

    finalListEl.innerHTML = '';
    rest.forEach((p, i) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="f-rank">${i + 4}</span>
        <span class="f-name">${escapeHtml(p.name)}</span>
        <span class="f-sport">${escapeHtml(p.sport || '')}</span>
        <span class="f-score">${formatScore(p.score || 0)}</span>
      `;
      finalListEl.appendChild(li);
    });
  }

  function initials(name) {
    return (name || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(w => w[0].toUpperCase())
      .join('');
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ── Realtime subscriptions ────────────────────────────────────────────
  // Debounced: burst of N player/answer changes → one SELECT, not N.
  function debounce(fn, ms) {
    let t = null;
    return function () {
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; fn(); }, ms);
    };
  }
  const debouncedPlayersFan = debounce(() => {
    if (gameStatus === 'lobby')    refreshPlayers();
    if (gameStatus === 'active')   refreshLeaderboard();
    if (gameStatus === 'finished') renderFinal();
    refreshAnswered();
  }, 250);
  const debouncedAnswered = debounce(refreshAnswered, 200);

  sb.channel('display-game-' + gameId)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
      (payload) => applyGame(payload.new))
    .subscribe();

  sb.channel('display-players-' + gameId)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'players', filter: `game_id=eq.${gameId}` },
      () => debouncedPlayersFan())
    .subscribe();

  sb.channel('display-answers-' + gameId)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'answers', filter: `game_id=eq.${gameId}` },
      () => debouncedAnswered())
    .subscribe();

  // If the display laptop wakes from sleep or the tab was backgrounded, pull fresh state.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const { data: game } = await sb
      .from('games')
      .select('id,name,status,current_question_id,question_phase,question_started_at')
      .eq('id', gameId)
      .maybeSingle();
    if (game) applyGame(game);
  });

  // ── Init ──────────────────────────────────────────────────────────────
  loadQuestions().then(loadGame);
})();
