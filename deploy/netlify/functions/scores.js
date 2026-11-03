// GET /api/scores[?week=11]
// Every imported league's live matchup, starters only, in one payload.
// Cached 20s at the edge so a phone polling every 30s costs one upstream call.
const { requireUser, json, fail } = require('./_lib/auth');
const { getCreds, getPrefs } = require('./_lib/store');
const espn = require('./_lib/espn');

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'GET') return json(405, { error: 'Use GET.' });
    const user = requireUser(context, event);
    const q = event.queryStringParameters || {};
    const prefs = await getPrefs(user.id);
    if (!prefs.leagues.length) return json(200, { week: null, leagues: [] });

    const week = Number(q.week || process.env.WEEK || 0) || (await currentWeek());
    const credCache = {};
    const load = async (platform) => (credCache[platform] = credCache[platform] || getCreds(user.id, platform));

    const results = await Promise.all(prefs.leagues.map(async (l) => {
      try {
        if (l.platform !== 'ESPN') return { key: l.platform + ':' + l.leagueId, error: l.platform + ' adapter not implemented yet.' };
        const creds = await load('ESPN');
        const s = await espn.leagueScores(creds, { season: l.season, leagueId: l.leagueId, teamId: l.teamId, week });
        return Object.assign({ key: 'ESPN:' + l.leagueId, hidden: (prefs.hidden || []).indexOf('ESPN:' + l.leagueId) >= 0 }, s);
      } catch (e) {
        return { key: l.platform + ':' + l.leagueId, leagueName: l.leagueName, teamName: l.teamName, error: e.message };
      }
    }));

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'private, max-age=20',
        'netlify-cdn-cache-control': 'private, max-age=20'
      },
      body: JSON.stringify({ week, leagues: results })
    };
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
