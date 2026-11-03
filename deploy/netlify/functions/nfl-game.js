// GET /api/nfl-game?id=<espn event id> — scoring summary for one game. Public, no auth.
exports.handler = async (event) => {
  const id = String((event.queryStringParameters || {}).id || '').trim();
  const out = (code, body, cache) => ({
    statusCode: code,
    headers: Object.assign({ 'content-type': 'application/json' }, cache ? { 'netlify-cdn-cache-control': 'public, max-age=20' } : {}),
    body: JSON.stringify(body)
  });
  if (!/^[0-9]+$/.test(id)) return out(400, { error: 'A game id is required.' });
  try {
    const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=' + id);
    if (!r.ok) return out(502, { error: 'ESPN returned ' + r.status + ' for that game.' });
    const d = await r.json();
    const c = ((d.header || {}).competitions || [])[0] || {};
    const side = (h) => (c.competitors || []).find(x => x.homeAway === h) || {};
    const away = side('away'), home = side('home');
    const plays = (d.scoringPlays || []).map(p => ({
      period: (p.period || {}).number || null,
      clock: (p.clock || {}).displayValue || '',
      team: ((p.team || {}).abbreviation) || '',
      type: ((p.type || {}).text) || '',
      text: p.text || '',
      away: p.awayScore, home: p.homeScore
    }));
    // Box score: passing / rushing / receiving per team, trimmed to the key columns.
    const WANT = {
      passing: ['C/ATT', 'YDS', 'TD', 'INT'],
      rushing: ['CAR', 'YDS', 'TD', 'LONG'],
      receiving: ['REC', 'YDS', 'TD', 'TGTS'],
      kicking: ['FG', 'XP', 'LONG', 'PTS']
    };
    const box = Object.keys(WANT).map(name => {
      const teams = ((d.boxscore || {}).players || []).map(t => {
        const g = (t.statistics || []).find(s => s.name === name) || {};
        const labels = g.labels || [];
        const cols = WANT[name].filter(c => labels.indexOf(c) >= 0);
        return {
          team: (t.team || {}).abbreviation || '',
          cols,
          rows: (g.athletes || []).map(a => ({
            name: ((a.athlete || {}).shortName) || ((a.athlete || {}).displayName) || '',
            vals: cols.map(c => (a.stats || [])[labels.indexOf(c)] || '')
          }))
        };
      }).filter(t => t.rows.length);
      return { name: name.toUpperCase(), teams };
    }).filter(g => g.teams.length);
    // Team defense: sacks from the defensive group, interceptions from the interceptions
    // group, fumble recoveries = the opponent's fumbles lost.
    const sides = (d.boxscore || {}).players || [];
    const total = (t, name, label) => {
      const g = (t && t.statistics || []).find(s => s.name === name);
      if (!g) return 0;
      const i = (g.labels || []).indexOf(label);
      if (i < 0) return 0;
      if (g.totals && g.totals[i] != null && g.totals[i] !== '') return Number(g.totals[i]) || 0;
      return (g.athletes || []).reduce((a, x) => a + (Number((x.stats || [])[i]) || 0), 0);
    };
    const teamYards = (abbr) => {
      const t = ((d.boxscore || {}).teams || []).find(x => (x.team || {}).abbreviation === abbr);
      const s = ((t && t.statistics) || []).find(x => x.name === 'totalYards');
      return s ? String(s.displayValue != null ? s.displayValue : s.value) : '0';
    };
    const defense = sides.map((t, i) => {
      const opp = sides[1 - i];
      const sacks = total(t, 'defensive', 'SACKS');
      return {
        team: (t.team || {}).abbreviation || '',
        cols: ['SACKS', 'FUM REC', 'INT', 'YDS ALLOW'],
        rows: [{ name: 'D/ST', vals: [String(Math.round(sacks * 10) / 10), String(total(opp, 'fumbles', 'LOST')), String(total(t, 'interceptions', 'INT')), teamYards(((opp || {}).team || {}).abbreviation)] }]
      };
    });
    if (defense.length) box.push({ name: 'DEFENSE', teams: defense });
    return out(200, {
      id,
      box,
      away: (away.team || {}).abbreviation || '', home: (home.team || {}).abbreviation || '',
      awayPts: Number(away.score || 0), homePts: Number(home.score || 0),
      status: (((c.status || {}).type) || {}).shortDetail || '',
      plays
    }, true);
  } catch (e) {
    return out(502, { error: 'Could not reach ESPN for that game.' });
  }
};
