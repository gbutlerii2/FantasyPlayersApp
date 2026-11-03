// POST /api/link/espn/league   { leagueId, season? }
// Fallback for accounts whose league list the fan API does not return: paste the
// leagueId from the fantasy URL and we find your team in it.
const { requireUser, json, fail } = require('./_lib/auth');
const { getCreds } = require('./_lib/store');
const espn = require('./_lib/espn');

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
    const user = requireUser(context, event);
    const body = JSON.parse(event.body || '{}');
    const leagueId = String(body.leagueId || '').trim();
    if (!/^[0-9]+$/.test(leagueId)) return json(400, { error: 'League id should be the number from the fantasy URL.' });
    const season = Number(body.season || process.env.SEASON || new Date().getFullYear());
    const creds = await getCreds(user.id, 'ESPN');
    return json(200, { league: await espn.resolveLeague(creds, leagueId, season) });
  } catch (e) { return fail(e); }
};
