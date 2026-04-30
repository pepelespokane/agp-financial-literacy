// Player join flow.
// Writes a new row to `players`, stashes id in sessionStorage, redirects to play.html.

(function() {
  const { getGameId, savePlayerSession, loadPlayerSession, cleanName, cleanSport } = window.AGP;

  const form    = document.getElementById('join-form');
  const nameEl  = document.getElementById('name');
  const sportEl = document.getElementById('sport');
  const btn     = document.getElementById('join-btn');
  const status  = document.getElementById('status');

  // If the player already joined this session, skip straight to play.
  const existing = loadPlayerSession();
  if (existing && existing.game_id === getGameId()) {
    window.location.href = 'play.html' + window.location.search;
    return;
  }

  function showError(msg) {
    status.className = 'status status-error';
    status.textContent = msg;
  }
  function showOk(msg) {
    status.className = 'status status-ok';
    status.textContent = msg;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name  = cleanName(nameEl.value);
    const sport = cleanSport(sportEl.value);

    if (!name || name.length < 2) {
      showError('Please enter your first name.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Joining…';
    status.textContent = '';

    const gameId = getGameId();

    // Confirm the game exists and is joinable.
    const { data: game, error: gameErr } = await sb
      .from('games')
      .select('id,name,status')
      .eq('id', gameId)
      .maybeSingle();

    if (gameErr || !game) {
      showError('Game not found. Check with the presenter.');
      btn.disabled = false;
      btn.textContent = 'Join Game';
      return;
    }
    if (game.status === 'finished') {
      showError('This game is already over.');
      btn.disabled = false;
      btn.textContent = 'Join Game';
      return;
    }

    // Insert the player row.
    const { data: player, error: playerErr } = await sb
      .from('players')
      .insert({
        game_id: gameId,
        name,
        sport,
        score: 0,
      })
      .select()
      .single();

    if (playerErr || !player) {
      console.error(playerErr);
      showError('Could not join. Try again in a moment.');
      btn.disabled = false;
      btn.textContent = 'Join Game';
      return;
    }

    savePlayerSession({
      player_id: player.id,
      game_id: gameId,
      name: player.name,
      sport: player.sport,
    });

    showOk("You're in. Redirecting…");
    setTimeout(() => {
      window.location.href = 'play.html' + window.location.search;
    }, 400);
  });
})();
