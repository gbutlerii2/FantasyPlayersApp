// EFL Live data layer.
// Talks to the Netlify Functions in deploy/netlify/functions (see deploy/API.md).
// Every call degrades quietly: if the API is not reachable (opened as a local file,
// functions not deployed yet) the app stays on its built-in demo data.

let FIREBASE = '';

export function configure(opts) {
  if (opts && opts.firebase) FIREBASE = opts.firebase.replace(/\/+$/, '');
}

// ---------- session ----------
// The app owns accounts locally (any username, any password, stored on the device).
// There is no hosted account service, no email address and no verification step:
// the signed-in name is simply the key the functions store this user's data under.

const SESS = 'efl.session';

export function session() {
  try {
    const n = localStorage.getItem(SESS);
    return n ? { user: n, email: n } : null;
  } catch (e) { return null; }
}

// Called by the app right after a local sign-in.
export function adopt(name) {
  try { localStorage.setItem(SESS, String(name || '')); } catch (e) {}
  return session();
}

export function signOut() { try { localStorage.removeItem(SESS); } catch (e) {} }

// ---------- endpoints ----------

async function call(path, opts) {
  const s = session();
  const o = Object.assign({ headers: {} }, opts || {});
  o.headers = Object.assign({ 'content-type': 'application/json' }, o.headers);
  if (s) o.headers['x-efl-user'] = s.user;
  const r = await fetch(path, o);
  const text = await r.text();
  let d = null;
  try { d = text ? JSON.parse(text) : null; } catch (e) { throw new Error('Bad response from ' + path); }
  if (r.status === 401) throw new Error('Sign in first — the app did not send an account name.');
  if (!r.ok) throw new Error((d && d.error) || ('Request failed (' + r.status + ')'));
  return d;
}

// ---------- ESPN, stateless ----------
// No server-side storage: the two session cookies and the league list live on this
// device and travel with every request, so nothing has to be configured server-side.
// (They sit in localStorage — fine for a personal build, not for a shared machine.)

const ESPN = 'efl.espn';

export function setEspnCreds(swid, espn_s2) {
  try { localStorage.setItem(ESPN, JSON.stringify({ swid, espn_s2 })); } catch (e) {}
}
export function espnCreds() {
  try { return JSON.parse(localStorage.getItem(ESPN) || 'null'); } catch (e) { return null; }
}
export function clearEspnCreds() { try { localStorage.removeItem(ESPN); } catch (e) {} }
export const hasEspnCreds = () => !!espnCreds();

// ---------- phone handoff ----------
// iOS Safari refuses to run bookmarklets in many configurations, and tapping a league
// link opens the ESPN app instead of the browser. So: link once in a desktop browser,
// park the cookies under a short code in the Firebase database, type the code on the
// phone. The record is deleted the moment it is read and expires either way.

const CODE_TTL = 15 * 60 * 1000;

export async function sendHandoff(payload) {
  if (!FIREBASE) throw new Error('No database configured.');
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const r = await fetch(FIREBASE + '/handoff/' + code + '.json', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(Object.assign({ expires: Date.now() + CODE_TTL }, payload))
  });
  if (!r.ok) throw new Error('The database refused the write — check its rules.');
  return code;
}

export async function readHandoff(code) {
  if (!FIREBASE) throw new Error('No database configured.');
  const r = await fetch(FIREBASE + '/handoff/' + encodeURIComponent(code) + '.json');
  if (!r.ok) throw new Error('Could not reach the database.');
  const d = await r.json();
  if (!d) throw new Error('That code is not valid — generate a new one on the computer.');
  fetch(FIREBASE + '/handoff/' + encodeURIComponent(code) + '.json', { method: 'DELETE' }).catch(() => {});
  if (d.expires && Date.now() > d.expires) throw new Error('That code has expired — generate a new one.');
  if (d.swid && d.espn_s2) setEspnCreds(d.swid, d.espn_s2);
  return d;
}

const direct = (body) => call('/api/espn', { method: 'POST', body: JSON.stringify(body) });

export const espnLink = (swid, espn_s2, season) => direct({ op: 'link', swid, espn_s2, season });
export const espnLeague = (leagueId, season, teamId) =>
  direct(Object.assign({ op: 'league', leagueId, season, teamId }, espnCreds()));
export const espnPlayers = (leagueId, season, limit) =>
  direct(Object.assign({ op: 'players', leagueId, season, limit }, espnCreds()));
export const espnScores = (leagues, week) =>
  direct(Object.assign({ op: 'scores', leagues, week }, espnCreds()));

// Cheapest reachability probe: the one endpoint that needs no auth.
export async function ping() {
  try { await call('/api/nfl'); return true; } catch (e) { return false; }
}

export const nfl = () => call('/api/nfl');
export const nflGame = (id) => call('/api/nfl-game?id=' + encodeURIComponent(id));
export const playerStats = (week) => call('/api/player-stats' + (week ? '?week=' + week : ''));
export const getLeagues = () => call('/api/leagues');
export const discover = (platform) => call('/api/leagues?discover=' + encodeURIComponent(platform));
export const getScores = (week) => call('/api/scores' + (week ? '?week=' + week : ''));

export const linkEspn = (swid, espn_s2) =>
  call('/api/link/espn', { method: 'POST', body: JSON.stringify({ swid, espn_s2 }) });

export const resolveEspnLeague = (leagueId, season) =>
  call('/api/link/espn/league', { method: 'POST', body: JSON.stringify({ leagueId, season }) });

export const putLeagues = (platform, leagues) =>
  call('/api/leagues', { method: 'PUT', body: JSON.stringify({ platform, leagues }) });

export const putHidden = (hidden) =>
  call('/api/leagues', { method: 'PATCH', body: JSON.stringify({ hidden }) });

// ---------- Firebase RTDB (mirror / future use) ----------
// Write-through copy of a user's league selection, so a second device can pick it up
// before the functions layer is live. Requires read/write rules on /users/<key>.

export async function mirrorPrefs(key, prefs) {
  if (!FIREBASE || !key) return null;
  try {
    const r = await fetch(FIREBASE + '/users/' + encodeURIComponent(key) + '/prefs.json', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(prefs)
    });
    return r.ok ? prefs : null;
  } catch (e) { return null; }
}

export async function readPrefs(key) {
  if (!FIREBASE || !key) return null;
  try {
    const r = await fetch(FIREBASE + '/users/' + encodeURIComponent(key) + '/prefs.json');
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}
