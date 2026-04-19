// Small shared helpers.

// Read ?game=XYZ from the URL. Defaults to the live Gonzaga game.
function getGameId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('game') || 'gonzaga-2026-04-20';
}

// Local session storage for player identity (name, sport, player_id).
// Survives page navigation between join → play so returning players are remembered.
const SESSION_KEY = 'agp_trivia_player';

function savePlayerSession(player) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(player));
}

function loadPlayerSession() {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function clearPlayerSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

// Format a score with a comma separator.
function formatScore(n) {
  return (n || 0).toLocaleString('en-US');
}

// Trim + title-case a name. "  stephen pugh  " → "Stephen Pugh".
function cleanName(s) {
  return (s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .slice(0, 40);
}

function cleanSport(s) {
  return (s || '').trim().slice(0, 40);
}

window.AGP = { getGameId, savePlayerSession, loadPlayerSession, clearPlayerSession, formatScore, cleanName, cleanSport };
