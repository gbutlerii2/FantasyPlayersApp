// POST /api/espn   { op, swid, espn_s2, ... }
// Stateless ESPN bridge: no accounts, no server-side storage, nothing to configure.
// The device holds the two session cookies and its own league list, and sends them with
// each request; this function is only the CORS-free proxy ESPN requires.
//
//   op: 'link'    { swid, espn_s2, season? }                  -> { leagues, diagnostics, season }
//   op: 'league'  { swid, espn_s2, leagueId, season?, teamId? } -> { league }
//   op: 'scores'  { swid, espn_s2, leagues:[…], week? }        -> { week, leagues }
//   op: 'players' { swid, espn_s2, leagueId, season?, limit? }  -> { season, count, players }
const { json, fail } = require('./_lib/auth');
const espn = require('./_lib/espn');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
    const b = JSON.parse(event.body || '{}');
    const swid = String(b.swid || '').trim();
    const espn_s2 = String(b.espn_s2 || '').trim();
    if (!swid || !espn_s2) return json(400, { error: 'Both SWID and espn_s2 are required.' });
    const creds = { swid, espn_s2 };
    const season = Number(b.season || process.env.SEASON || new Date().getFullYear());

    if (b.op === 'link') {
      const found = await espn.listLeagues(creds, season);
      return json(200, { season, leagues: found.leagues, diagnostics: found.diagnostics });
    }

    if (b.op === 'league') {
      const leagueId = String(b.leagueId || '').trim();
      if (!/^[0-9]+$/.test(leagueId)) return json(400, { error: 'League id should be the number from the fantasy URL.' });
      return json(200, { league: await espn.resolveLeague(creds, leagueId, season, b.teamId || null) });
    }

    if (b.op === 'scores') {
      const leagues = Array.isArray(b.leagues) ? b.leagues : [];
      if (!leagues.length) return json(200, { week: null, leagues: [] });
      const week = Number(b.week || process.env.WEEK || 0) || (await currentWeek());
      const out = await Promise.all(leagues.map(async (l) => {
        const key = 'ESPN:' + l.leagueId;
        try {
          const s = await espn.leagueScores(creds, {
            season: Number(l.season || season), leagueId: String(l.leagueId), teamId: l.teamId, week
          });
          return Object.assign({ key }, s);
        } catch (e) {
          return { key, platform: 'ESPN', leagueName: l.leagueName, teamName: l.teamName, error: e.message };
        }
      }));
      return {
        statusCode: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'private, max-age=20',
          'netlify-cdn-cache-control': 'private, max-age=20'
        },
        body: JSON.stringify({ week, leagues: out })
      };
    }

    if (b.op === 'players') {
      const leagueId = String(b.leagueId || '').trim();
      if (!/^[0-9]+$/.test(leagueId)) return json(400, { error: 'A league id is needed to read the player pool.' });
      const week = Number(b.week || process.env.WEEK || 0) || (await currentWeek());
      return json(200, await espn.playerUniverse(creds, { leagueId, season, week, limit: Number(b.limit || 600) }));
    }

    return json(400, { error: 'Unknown op.' });
  } catch (e) { return fail(e); }
};

// ESPN publishes the active week on the public scoreboard — no cookies needed.
async function currentWeek() {
  try {
    const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
    const d = await r.json();
    return (d.week && d.week.number) || 1;
  } catch (e) { return 1; }
}
