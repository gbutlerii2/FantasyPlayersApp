// GET /api/player-stats[?week=11]
// Real box-score lines for every player on the slate, keyed by player name, plus each
// game's last play. Public data, so this is cached at the edge for everyone at once:
// one set of upstream calls per 20s no matter how many users are polling.
const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=';

const idx = (labels, want) => labels.findIndex(l => l.toUpperCase() === want);
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

// One readable line per athlete, assembled from whichever categories they appear in.
function lines(summary) {
  const out = {};
  const groups = (summary.boxscore && summary.boxscore.players) || [];
  groups.forEach(g => {
    (g.statistics || []).forEach(cat => {
      const L = cat.labels || [];
      (cat.athletes || []).forEach(a => {
        const name = a.athlete && a.athlete.displayName;
        if (!name) return;
        const s = a.stats || [];
        const get = (want) => { const i = idx(L, want); return i < 0 ? '' : s[i]; };
        let part = '';

        if (cat.name === 'passing') {
          const ca = get('C/ATT'), yd = get('YDS'), td = get('TD'), int = get('INT');
          part = [ca, yd + ' yd', num(td) ? td + ' TD' : '', num(int) ? int + ' INT' : '']
            .filter(Boolean).join(', ');
        } else if (cat.name === 'rushing') {
          const car = get('CAR'), yd = get('YDS'), td = get('TD');
          if (num(car)) part = [car + ' car', yd + ' yd', num(td) ? td + ' TD' : ''].filter(Boolean).join(', ');
        } else if (cat.name === 'receiving') {
          const rec = get('REC'), yd = get('YDS'), td = get('TD');
          if (num(rec)) part = [rec + ' rec', yd + ' yd', num(td) ? td + ' TD' : ''].filter(Boolean).join(', ');
        } else if (cat.name === 'kicking') {
          const fg = get('FG'), xp = get('XP');
          part = [fg ? fg + ' FG' : '', xp ? xp + ' XP' : ''].filter(Boolean).join(', ');
        } else if (cat.name === 'defensive') {
          const tot = get('TOT'), sacks = get('SACKS'), tfl = get('TFL');
          if (num(sacks)) part = [tot + ' tkl', sacks + ' sack'].filter(Boolean).join(', ');
          else if (num(tfl)) part = tot + ' tkl, ' + tfl + ' TFL';
        }

        if (!part) return;
        out[name] = out[name] ? out[name] + ' · ' + part : part;
      });
    });
  });
  return out;
}

// Team-level defensive summary, so a D/ST row has something to show.
function defenses(summary) {
  const out = {};
  const teams = (summary.boxscore && summary.boxscore.teams) || [];
  const comp = (summary.header && summary.header.competitions && summary.header.competitions[0]) || {};
  const score = {};
  (comp.competitors || []).forEach(c => { score[c.team.abbreviation] = num(c.score); });
  const abbrevs = teams.map(t => t.team && t.team.abbreviation);
  teams.forEach((t, i) => {
    const abbr = abbrevs[i];
    const opp = abbrevs[1 - i];
    if (!abbr) return;
    const find = (n) => ((t.statistics || []).find(s => s.name === n) || {}).displayValue;
    const allowed = score[opp];
    out[abbr] = [allowed != null ? allowed + ' pts allowed' : '', find('sacks') ? find('sacks') + ' sacks' : '',
      find('turnovers') ? find('turnovers') + ' TO forced' : ''].filter(Boolean).join(', ');
  });
  return out;
}

exports.handler = async (event) => {
  try {
    const week = (event.queryStringParameters || {}).week;
    const board = await (await fetch(SCOREBOARD + (week ? '?week=' + encodeURIComponent(week) : ''))).json();
    const events = (board.events || []).filter(e => {
      const st = e.competitions[0].status.type.state;
      return st === 'in' || st === 'post';
    });

    const players = {};
    const teamDefense = {};
    const lastPlay = {};

    const summaries = await Promise.all(events.map(async (e) => {
      try {
        const s = await (await fetch(SUMMARY + e.id)).json();
        const c = e.competitions[0];
        const play = c.situation && c.situation.lastPlay && c.situation.lastPlay.text;
        c.competitors.forEach(x => { if (play) lastPlay[x.team.abbreviation] = play; });
        return s;
      } catch (err) { return null; }
    }));

    summaries.filter(Boolean).forEach(s => {
      Object.assign(players, lines(s));
      Object.assign(teamDefense, defenses(s));
    });

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'netlify-cdn-cache-control': 'public, max-age=20, stale-while-revalidate=40'
      },
      body: JSON.stringify({ week: board.week && board.week.number, players, teamDefense, lastPlay })
    };
  } catch (e) {
    return { statusCode: 502, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'Box scores unavailable.' }) };
  }
};
