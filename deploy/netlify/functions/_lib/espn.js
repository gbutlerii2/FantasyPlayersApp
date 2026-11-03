// ESPN's fantasy endpoints are unofficial and read-only. Private leagues need the
// two session cookies (SWID + espn_s2) the user pastes in the app; they are sent
// only to espn.com from here, never to the browser again.
const READ = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
const FAN = 'https://fan.api.espn.com/apis/v2/fans';

// lineupSlotId -> slot label. Anything not listed is bench/IR and is dropped.
// Kickers (17) and D/ST (16) are starting slots like any other; the multi-position slots
// are here too so a league using them never has starters silently dropped.
const SLOT = { 0: 'QB', 2: 'RB', 3: 'RB/WR', 4: 'WR', 5: 'WR/TE', 6: 'TE', 7: 'OP',
  16: 'DST', 17: 'K', 23: 'FLEX' };
const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };
const STARTING = Object.keys(SLOT).map(Number);

const cookie = (c) => 'SWID=' + c.swid + '; espn_s2=' + c.espn_s2;

async function espn(url, c) {
  const r = await fetch(url, {
    headers: { cookie: cookie(c), accept: 'application/json', 'x-fantasy-source': 'kona' }
  });
  if (r.status === 401 || r.status === 403) {
    throw Object.assign(new Error('ESPN rejected the session cookies — relink the account.'), { status: 401 });
  }
  if (!r.ok) throw Object.assign(new Error('ESPN returned ' + r.status + '.'), { status: 502 });
  return r.json();
}

// Every fantasy league on the account. ESPN's fan API is inconsistent about which
// fields carry the league, so this parses defensively and never silently returns nothing:
// the diagnostics come back with the result so the client can say what was found.
exports.listLeagues = async (c, season) => {
  const url = FAN + '/' + encodeURIComponent(c.swid.trim()) +
    '?context=fantasy&featureFlags=expandAthlete&displayEvents=true&displayNow=true&displayRecs=false&recLimit=5&showAirings=buy,live,replay';
  const fan = await espn(url, c);
  const prefs = fan.preferences || [];
  const entries = prefs.map(p => p && p.metaData && p.metaData.entry).filter(Boolean);

  const mapped = entries.map(e => {
    const g = (e.groups || [])[0] || {};
    return {
      platform: 'ESPN',
      abbrev: e.abbrev || '',
      season: e.seasonId,
      leagueId: String(g.groupId || e.groupId || ''),
      leagueName: g.groupName || e.name || 'ESPN league',
      teamId: e.entryId,
      teamName: (e.entryMetadata && e.entryMetadata.teamName) || e.name || 'My team',
      teamAbbrev: e.entryMetadata && e.entryMetadata.teamAbbrev
    };
  }).filter(l => l.leagueId);

  // Prefer football; fall back to everything rather than showing an empty list.
  let out = mapped.filter(l => l.abbrev === 'FFL');
  if (!out.length) out = mapped;
  // Narrow to the requested season only if that leaves something.
  if (season) {
    const s = out.filter(l => Number(l.season) === Number(season));
    if (s.length) out = s;
  }
  out.sort((a, b) => (b.season || 0) - (a.season || 0));

  return {
    leagues: out,
    diagnostics: {
      preferences: prefs.length,
      entries: entries.length,
      football: mapped.filter(l => l.abbrev === 'FFL').length,
      seasons: mapped.map(l => l.season).filter((v, i, a) => a.indexOf(v) === i)
    }
  };
};

// Manual fallback: the user pastes a leagueId from the fantasy URL and we find their
// team in it by matching the SWID against the team owners.
exports.resolveLeague = async (c, leagueId, season, teamId) => {
  const d = await espn(READ + '/seasons/' + season + '/segments/0/leagues/' + leagueId + '?view=mTeam&view=mSettings', c);
  const bare = s => String(s || '').replace(/[{}]/g, '').toLowerCase();
  // A teamId pasted from the fantasy URL is authoritative — no owner match needed.
  const me = teamId
    ? (d.teams || []).find(t => String(t.id) === String(teamId))
    : (d.teams || []).find(t => (t.owners || []).some(o => bare(o) === bare(c.swid)));
  if (!me && teamId) {
    throw Object.assign(new Error('League ' + leagueId + ' has no team ' + teamId + ' in season ' + season + '.'), { status: 404 });
  }
  if (!me) {
    throw Object.assign(new Error('That league exists but the signed-in ESPN user has no team in it.'), { status: 404 });
  }
  return {
    platform: 'ESPN',
    season: Number(season),
    leagueId: String(leagueId),
    leagueName: (d.settings && d.settings.name) || 'ESPN league',
    teamId: me.id,
    teamName: me.name || [me.location, me.nickname].filter(Boolean).join(' ') || 'My team'
  };
};

// One league's live matchup for the given week, starters only.
exports.leagueScores = async (c, { season, leagueId, teamId, week }) => {
  const views = ['mMatchupScore', 'mRoster', 'mTeam', 'mSettings', 'mScoreboard', 'mLiveScoring']
    .map(v => 'view=' + v).join('&');
  const d = await espn(READ + '/seasons/' + season + '/segments/0/leagues/' + leagueId + '?' + views + '&scoringPeriodId=' + week, c);

  const teams = {};
  (d.teams || []).forEach(t => { teams[t.id] = t; });
  const nameOf = t => (t && (t.name || [t.location, t.nickname].filter(Boolean).join(' '))) || 'Team';

  const mine = (d.schedule || []).filter(m =>
    (m.home && m.home.teamId === teamId) || (m.away && m.away.teamId === teamId));
  const cur = d.status && d.status.currentMatchupPeriod;
  const match = mine.find(m => m.matchupPeriodId === cur)
    || mine.find(m => m.matchupPeriodId === week)
    || mine[0];
  if (!match) {
    throw Object.assign(new Error('League ' + leagueId + ' has no schedule for team ' + teamId + ' yet.'), { status: 404 });
  }

  const meSide = match.home && match.home.teamId === teamId ? match.home : match.away;
  const oppSide = meSide === match.home ? match.away : match.home;

  const entriesFor = (side) => {
    const live = (side.rosterForCurrentScoringPeriod || {}).entries;
    if (live && live.length) return live;
    const t = teams[side.teamId] || {};
    return (t.roster && t.roster.entries) || [];
  };

  const starters = (side) => entriesFor(side)
    .filter(e => STARTING.indexOf(e.lineupSlotId) >= 0)
    .map(e => {
      const pl = (e.playerPoolEntry && e.playerPoolEntry.player) || {};
      const stats = pl.stats || [];
      const actual = stats.find(s => s.statSourceId === 0 && s.scoringPeriodId === week);
      const proj = stats.find(s => s.statSourceId === 1 && s.scoringPeriodId === week);
      return {
        slot: SLOT[e.lineupSlotId],
        name: pl.fullName || pl.name,
        pos: POS[pl.defaultPositionId] || SLOT[e.lineupSlotId],
        proTeamId: pl.proTeamId,
        points: round(actual && actual.appliedTotal),
        projected: round(proj && proj.appliedTotal),
        // 0 not yet played, 2 in progress, 1/3 done — normalized in the client adapter
        gameStatus: pl.injuryStatus === 'OUT' ? 'out' : undefined
      };
    })
    .sort(bySlotOrder(d));

  return {
    platform: 'ESPN',
    season, leagueId: String(leagueId), teamId,
    leagueName: (d.settings && d.settings.name) || 'ESPN league',
    week,
    slots: slotTemplate(d),
    // Every player on my team (bench included) so the client can mark "mine" in the pool.
    roster: entriesFor(meSide).map(e => e.playerId || (e.playerPoolEntry && e.playerPoolEntry.id)).filter(Boolean),
    team: { name: nameOf(teams[teamId]), points: round(meSide.totalPointsLive != null ? meSide.totalPointsLive : meSide.totalPoints), projected: round(meSide.totalProjectedPointsLive), starters: starters(meSide) },
    opponent: { name: nameOf(teams[oppSide.teamId]), points: round(oppSide.totalPointsLive != null ? oppSide.totalPointsLive : oppSide.totalPoints), projected: round(oppSide.totalProjectedPointsLive) }
  };
};

// The league's real starting lineup shape, e.g. ['QB','RB','RB','RB','WR','WR','WR','TE','DST','K']
function slotTemplate(d) {
  const counts = (d.settings && d.settings.rosterSettings && d.settings.rosterSettings.lineupSlotCounts) || {};
  const out = [];
  STARTING.forEach(id => { for (let i = 0; i < (counts[id] || 0); i++) out.push(SLOT[id]); });
  return out;
}

function bySlotOrder(d) {
  const order = slotTemplate(d);
  return (a, b) => order.indexOf(a.slot) - order.indexOf(b.slot);
}

function round(n) { return n == null ? null : Math.round(n * 10) / 10; }

// ESPN stat ids -> the box-score line for each position.
const RECV = [['TGT', 58], ['REC', 53], ['REC YDS', 42], ['REC TD', 43], ['RUSH YDS', 24], ['FUM LOST', 72]];
const LINES = {
  QB: [['C/A', [1, 0]], ['PASS YDS', 3], ['PASS TD', 4], ['INT', 20], ['RUSH YDS', 24], ['RUSH TD', 25]],
  RB: [['CAR', 23], ['RUSH YDS', 24], ['RUSH TD', 25], ['REC', 53], ['REC YDS', 42], ['REC TD', 43]],
  WR: RECV, TE: RECV,
  K: [['FG', [83, 84]], ['FG 50+', 74], ['XP', [86, 87]]],
  DST: [['SACK', 99], ['INT', 95], ['FUM REC', 96], ['PTS ALLOWED', 120], ['YDS ALLOWED', 127]]
};
function statLine(s, pos) {
  s = s || {};
  const v = id => String(Math.round(Number(s[id] || 0)));
  return (LINES[pos] || LINES.RB).map(([label, id]) => ({
    label, value: Array.isArray(id) ? v(id[0]) + '/' + v(id[1]) : v(id)
  }));
}

// ---- the whole player pool, with season totals and projections ----------------
// kona_player_info is the same feed the ESPN app's player list uses. It needs a league
// for scoring rules, so we borrow one of the user's own leagues.
const PRO = { 1:'ATL',2:'BUF',3:'CHI',4:'CIN',5:'CLE',6:'DAL',7:'DEN',8:'DET',9:'GB',10:'TEN',
  11:'IND',12:'KC',13:'LV',14:'LAR',15:'MIA',16:'MIN',17:'NE',18:'NO',19:'NYG',20:'NYJ',
  21:'PHI',22:'ARI',23:'PIT',24:'LAC',25:'SF',26:'SEA',27:'TB',28:'WSH',29:'CAR',30:'JAX',
  33:'BAL',34:'HOU' };

exports.playerUniverse = async (c, { leagueId, season, limit, week }) => {
  const filter = {
    players: {
      filterStatus: { value: ['FREEAGENT', 'WAIVERS', 'ONTEAM'] },
      limit: limit || 600,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
      // Ask for every weekly split (actual + projected) for this season, not just totals.
      filterStatsForTopScoringPeriodIds: { value: 18, additionalValue: ['00' + season, '10' + season] }
    }
  };
  const r = await fetch(READ + '/seasons/' + season + '/segments/0/leagues/' + leagueId + '?view=kona_player_info' + (week ? '&scoringPeriodId=' + week : ''), {
    headers: {
      cookie: cookie(c),
      accept: 'application/json',
      'x-fantasy-source': 'kona',
      'x-fantasy-filter': JSON.stringify(filter)
    }
  });
  if (r.status === 401 || r.status === 403) {
    throw Object.assign(new Error('ESPN rejected the session cookies — relink the account.'), { status: 401 });
  }
  if (!r.ok) throw Object.assign(new Error('ESPN returned ' + r.status + ' for the player list.'), { status: 502 });
  const d = await r.json();

  const players = (d.players || []).map(w => {
    const p = w.player || {};
    const stats = p.stats || [];
    const season0 = (src) => stats.find(s => s.statSourceId === src && s.statSplitTypeId === 0 && Number(s.seasonId) === Number(season));
    const pos = POS[p.defaultPositionId] || 'FLEX';
    const weekly = stats
      .filter(s => s.statSourceId === 0 && s.statSplitTypeId === 1 && s.appliedTotal != null && Number(s.seasonId) === Number(season))
      .map(s => ({ week: s.scoringPeriodId, points: round(s.appliedTotal),
        line: statLine(s.stats, pos).filter(x => x.value !== '0' && x.value !== '0/0').slice(0, 4).map(x => x.value + ' ' + x.label).join(' · ') }))
      .sort((a, b) => a.week - b.week);
    const weekProj = {};
    stats.filter(s => s.statSourceId === 1 && s.statSplitTypeId === 1 && s.appliedTotal != null && Number(s.seasonId) === Number(season))
      .forEach(s => { weekProj[s.scoringPeriodId] = round(s.appliedTotal); });
    const act = season0(0), proj = season0(1);
    return {
      id: p.id,
      name: p.fullName,
      pos: POS[p.defaultPositionId] || 'FLEX',
      team: PRO[p.proTeamId] || 'FA',
      injury: p.injuryStatus || null,
      owned: p.ownership ? Math.round(p.ownership.percentOwned || 0) : null,
      seasonPoints: round(act && act.appliedTotal),
      seasonAverage: round(act && act.appliedAverage),
      projPoints: round(proj && proj.appliedTotal),
      projAverage: round(proj && proj.appliedAverage),
      statLine: act ? statLine(act.stats, pos) : [],
      weeks: weekly,
      weekProj
    };
  }).filter(p => p.name);

  return { season, week: week || null, count: players.length, players };
};
