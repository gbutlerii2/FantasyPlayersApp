// POST /api/link/espn   { swid, espn_s2 }
// Validates the cookies against ESPN, stores them sealed, returns the account's leagues.
const { requireUser, json, fail } = require('./_lib/auth');
const { putCreds } = require('./_lib/store');
const espn = require('./_lib/espn');

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
    const user = requireUser(context, event);
    const { swid, espn_s2 } = JSON.parse(event.body || '{}');
    if (!swid || !espn_s2) return json(400, { error: 'Both SWID and espn_s2 are required.' });

    const creds = { swid: swid.trim(), espn_s2: espn_s2.trim(), linkedAt: Date.now() };
    const season = Number(process.env.SEASON || new Date().getFullYear());
    const found = await espn.listLeagues(creds, season);

    // The cookies are valid (ESPN answered), so keep them even if discovery came back
    // empty — the user can still add a league by id.
    await putCreds(user.id, 'ESPN', creds);
    return json(200, {
      platform: 'ESPN',
      handle: 'SWID ' + creds.swid.slice(0, 6) + '…',
      season,
      leagues: found.leagues,
      diagnostics: found.diagnostics
    });
  } catch (e) { return fail(e); }
};
