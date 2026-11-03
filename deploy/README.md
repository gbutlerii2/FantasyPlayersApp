# EFL Live — Netlify deploy

Drag this whole `deploy` folder onto app.netlify.com/drop, or connect it as the publish directory.

- `index.html` — the app, one self-contained file (built from `EFL Live -app-.dc.html`)
- `api.js` — the data layer the app imports at runtime. Must stay beside `index.html`.
- `link-espn.html` — one-click cookie bookmarklet page (`/link-espn.html` on the site)
- `netlify/functions/` — the server: account-gated endpoints, the ESPN proxy, box scores
- `netlify.toml` — publish root, functions directory, `/api/*` redirects
- `_headers` — basic security headers
- `API.md` — endpoint reference and notes

## Before the first deploy

1. **Accounts** — nothing to configure. The app keeps accounts on the device: any username
   and password, no email, no verification. The signed-in name is sent as `x-efl-user` and
   is the key each user's leagues and credentials are stored under.
2. **Env vars** — Site configuration → Environment variables:
   - `CRED_KEY` — 32 random bytes, base64: `openssl rand -base64 32`
   - `NETLIFY_SITE_ID` + `NETLIFY_API_TOKEN` — only if a request fails with "The environment
     has not been configured to use Netlify Blobs". Site ID: Site configuration → General.
     Token: User settings → Applications → new personal access token.
   - `SEASON` — e.g. `2026`
3. **Dependency** — the functions need `@netlify/blobs`. If you deploy by dragging the
   folder, add a `package.json` at the deploy root with
   `{"dependencies":{"@netlify/blobs":"^8.1.0"}}` and let Netlify install it; if you deploy
   from git, add it to the repo's `package.json` instead.

## Testing the ESPN link

1. Open the site, ADMIN tab, create an account (that's the app's own, not ESPN).
2. The header chip should read `SYNCED` rather than `DEMO DATA · API OFFLINE`. If it says
   offline, the functions aren't up — everything below will run on demo data.
3. In another tab sign in at fantasy.espn.com, open devtools → Application → Cookies →
   `espn.com`, and copy `SWID` (with the braces) and `espn_s2`. Or visit `/link-espn.html`,
   drag the bookmarklet to your bookmarks bar, and click it from an espn.com tab — it opens
   the app with both cookies already filled in.
4. ADMIN → `+ LINK AN ACCOUNT` → ESPN → paste both → `FIND MY LEAGUES`. The function
   validates the cookies against ESPN and answers with every football league on the
   account; pick the ones you want and import.
5. LIVE tab shows one column per league, starters only, refreshing every 30 seconds.

If step 4 errors, the message comes straight from the function — `ESPN rejected the session
cookies` means they're stale (sign in again and recopy), `CRED_KEY is not configured` means
step 2 was skipped.

If step 4 succeeds but the list comes back **empty**, the screen now says what ESPN's
account feed actually returned (how many entries, which seasons) and offers an
**ADD BY LEAGUE ID** field — paste the number after `leagueId=` in your fantasy URL and the
server finds your team in that league by matching your SWID against the team owners. That
path works even when the account feed omits the league.

## Rebuilding

Change `EFL Live -app-.dc.html`, re-bundle it to `index.html`, and copy `api.js` across.

## Not wired yet

Sleeper, Yahoo and NFL.com linking (the platform picker shows them, the server answers
"not wired yet"). Firebase RTDB is written to as a mirror of league selections only, with
open rules for now.
