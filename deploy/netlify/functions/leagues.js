// GET  /api/leagues                    -> { leagues, hidden }        imported leagues
// GET  /api/leagues?discover=ESPN      -> { leagues }                everything on the linked account
// PUT  /api/leagues   { platform, leagues:[{leagueId,teamId,leagueName,teamName,season}] }
//                                      -> replaces that platform's imported set
// PATCH /api/leagues  { hidden:[key] } -> which leagues the LIVE view shows
const { requireUser, json, fail } = require('./_lib/auth');
const { getCreds, getPrefs, putPrefs } = require('./_lib/store');
const espn = require('./_lib/espn');

const key = l => l.platform + ':' + l.leagueId;

exports.handler = async (event, context) => {
  try {
    const user = requireUser(context, event);
    const season = Number(process.env.SEASON || new Date().getFullYear());

    if (event.httpMethod === 'GET') {
      const discover = (event.queryStringParameters || {}).discover;
      if (!discover) return json(200, await getPrefs(user.id));
      if (discover !== 'ESPN') return json(400, { error: 'Only ESPN discovery is implemented.' });
      const creds = await getCreds(user.id, 'ESPN');
      const found = await espn.listLeagues(creds, season);
      return json(200, { leagues: found.leagues, diagnostics: found.diagnostics });
    }

    if (event.httpMethod === 'PUT') {
      const body = JSON.parse(event.body || '{}');
      if (!body.platform || !Array.isArray(body.leagues)) return json(400, { error: 'platform and leagues are required.' });
      const prefs = await getPrefs(user.id);
      const kept = prefs.leagues.filter(l => l.platform !== body.platform);
      prefs.leagues = kept.concat(body.leagues.map(l => ({
        platform: body.platform,
        season: l.season || season,
        leagueId: String(l.leagueId),
        teamId: Number(l.teamId),
        leagueName: l.leagueName,
        teamName: l.teamName
      })));
      await putPrefs(user.id, prefs);
      return json(200, prefs);
    }

    if (event.httpMethod === 'PATCH') {
      const body = JSON.parse(event.body || '{}');
      const prefs = await getPrefs(user.id);
      if (Array.isArray(body.hidden)) prefs.hidden = body.hidden;
      await putPrefs(user.id, prefs);
      return json(200, prefs);
    }

    return json(405, { error: 'Use GET, PUT or PATCH.' });
  } catch (e) { return fail(e); }
};
