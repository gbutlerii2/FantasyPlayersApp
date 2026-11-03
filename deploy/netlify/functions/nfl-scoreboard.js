// GET /api/nfl  — public NFL scoreboard for the NFL tab. No auth, cached 20s.
exports.handler = async () => {
  const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
  const d = await r.json();
  const games = (d.events || []).map(e => {
    const c = e.competitions[0];
    const away = c.competitors.find(x => x.homeAway === 'away');
    const home = c.competitors.find(x => x.homeAway === 'home');
    return {
      id: e.id,
      away: away.team.abbreviation, home: home.team.abbreviation,
      awayPts: Number(away.score), homePts: Number(home.score),
      state: c.status.type.state, // pre | in | post
      clock: c.status.type.shortDetail,
      tv: ((c.broadcasts || [])[0] || {}).names ? c.broadcasts[0].names[0] : ''
    };
  });
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'netlify-cdn-cache-control': 'public, max-age=20' },
    body: JSON.stringify({ week: d.week && d.week.number, games })
  };
};
