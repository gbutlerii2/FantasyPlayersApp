# EFL Live — server API

Netlify Functions + Netlify Blobs. The phone never holds a platform credential after the
link step. Accounts are device-local (any username and password, no email, no
verification); the signed-in name travels as the `x-efl-user` header and is the storage
key for that user's leagues and credentials.

## Setup

2. Env vars: `CRED_KEY` (32 random bytes, base64: `openssl rand -base64 32`), `SEASON` (e.g. 2026).
3. `npm i @netlify/blobs` in the site root.
3. Every call below sends `x-efl-user: <username>`; `_lib/auth.requireUser` turns it into a
   storage id. A missing header is a 401. Note this is trust-the-client identification —
   fine for a personal build, not a shared one.

## Endpoints

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| POST | `/api/link/espn` | `{ swid, espn_s2 }` | `{ platform, handle, leagues[] }` — validates against ESPN, seals the cookies |
| GET | `/api/leagues` | — | `{ leagues[], hidden[] }` imported set |
| GET | `/api/leagues?discover=ESPN` | — | `{ leagues[] }` everything on the linked account |
| PUT | `/api/leagues` | `{ platform, leagues[] }` | replaces that platform's imported set |
| PATCH | `/api/leagues` | `{ hidden: [key] }` | which leagues the LIVE view shows |
| GET | `/api/scores` | `?week=11` (optional) | `{ week, leagues[] }` all matchups, starters only |
| GET | `/api/nfl` | — | `{ week, games[] }` public scoreboard, no auth |
| GET | `/api/player-stats` | `?week=11` (optional) | `{ week, players{}, teamDefense{}, lastPlay{} }` box-score lines, no auth |

League key is `PLATFORM:leagueId` — the same key the client uses for show/hide.

## Redirects

Add to `netlify.toml`:

```toml
[[redirects]]
  from = "/api/link/espn"
  to = "/.netlify/functions/link-espn"
  status = 200
[[redirects]]
  from = "/api/leagues"
  to = "/.netlify/functions/leagues"
  status = 200
[[redirects]]
  from = "/api/scores"
  to = "/.netlify/functions/scores"
  status = 200
[[redirects]]
  from = "/api/nfl"
  to = "/.netlify/functions/nfl-scoreboard"
  status = 200
```

## Notes on ESPN

- Endpoints are unofficial and undocumented; they change without notice. Reads only.
- `lm-api-reads.fantasy.espn.com` needs `SWID` + `espn_s2` as a cookie header for private
  leagues. Browsers cannot send these cross-origin, which is why the proxy exists.
- Starters come from `rosterForCurrentScoringPeriod.entries` filtered by `lineupSlotId`:
  0 QB · 2 RB · 4 WR · 6 TE · 16 D/ST · 17 K · 23 FLEX. 20 (bench) and 21 (IR) are dropped.
- The league's real lineup shape is read from `settings.rosterSettings.lineupSlotCounts`,
  so a 3-RB league renders three RB rows without hardcoding.
- Live points: `statSourceId 0` is actual, `1` is projected, for `scoringPeriodId = week`.
- Box-score lines come from the public `summary?event=` endpoint, not the fantasy API, so
  they carry labels instead of numeric stat ids. Merged to fantasy starters by player name;
  D/ST rows fall back to a team line (points allowed, sacks, turnovers forced).
- `/api/player-stats` is public and cached publicly for 20s, so the ~13 upstream summary
  calls happen once per 20s for the whole site, not once per user.
- `/api/scores` caches 20s per user at the edge; a 30s client poll is one upstream call.

## Firebase

Rules are currently wide open (`".read": true, ".write": true`) — fine for testing, but
anyone with the URL can read or overwrite every user's data, so this must be locked down
before the app is shared. Once Firebase Auth is in, the rules become
`"users": { "$uid": { ".read": "$uid === auth.uid", ".write": "$uid === auth.uid" } }`.

`https://fantasyplayersapp-default-rtdb.firebaseio.com/` is wired into the client as a
write-through mirror of a user's league selection: after every successful sync the app
PUTs `/users/<email>/prefs.json`. Nothing reads it yet as a source of truth — the
functions layer remains authoritative.

To use it, the database rules must allow that path. For anything real, move to Firebase
Auth and rules keyed on `auth.uid` instead of an email path, and send me the web config
(`apiKey`, `authDomain`, `projectId`) so sign-in can move off Netlify Identity.

Open question worth settling before more is built on it: one store or two. Firebase Auth +
RTDB could replace Identity + Blobs entirely, leaving the Netlify function as nothing but
the ESPN cookie proxy — which is the only part that genuinely has to be server-side.

## Still to write

Sleeper (public read API, no auth — easiest next), Yahoo (OAuth2 with refresh tokens,
needs a consumer key and a callback function), NFL.com (no usable public API; likely
manual league entry).
