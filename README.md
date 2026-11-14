# Madras FC · Club Stats

A free, self-updating stats site for **MADRAS  FC** (EA FC 27 Pro Clubs, 11v11 league, club ID `830697`).

- **Updater** — a GitHub Action runs every 2 hours, pulls the latest matches from EA, and saves them to this repo's `data` branch. EA only keeps your last 10 matches, so this is what builds your full history.
- **Website** — plain HTML in `site/`, hosted on Netlify. It reads the data live from GitHub, so **new matches never trigger a Netlify deploy** (no credits used).

## One-time setup

### 1. GitHub
1. Create a **public** repository (e.g. `madras-fc-stats`) and push this project to it.
   *Public is needed so the website can read the data. It only contains gamertags and match stats, which EA already makes public.*
2. Go to **Actions** → enable workflows if asked → **Fetch Madras FC data** → **Run workflow**.
3. When it finishes (about a minute), a `data` branch appears with `matches.json` etc.
   - If it fails with HTTP 403, EA is blocking GitHub's servers — see *If EA blocks the updater* below.

### 2. Point the site at your data
Edit `site/config.js` and replace the placeholders:
```js
dataBase: 'https://raw.githubusercontent.com/akshKN/madras-fc-stats/data/',
```
Commit and push.

### 3. Netlify
1. **Add new project** → **Import an existing project** → **GitHub** → pick the repo.
2. Leave the settings as detected (`netlify.toml` sets everything: publish folder `site`, no build).
3. Deploy. Optionally rename the site to something like `madras-fc.netlify.app` (Project configuration → Change project name).
4. Check **Project configuration → Build & deploy → Branches and deploy contexts** shows *Deploy only the production branch* (main). The `data` branch must not deploy.

That's it — the site updates itself.

## Cost
$0. Netlify only redeploys when files in `site/` change (each production deploy costs 15 of your 300 monthly credits, shared with your other site). Match updates cost nothing.

## What can break (and what happens)

| Risk | Likelihood | What you'll see | Fix |
|---|---|---|---|
| EA changes or removes the unofficial API | Medium (yearly at least) | Yellow "hasn't refreshed" banner; GitHub emails you about failed runs | Update `scripts/lib/ea.mjs` for the new endpoints |
| EA blocks GitHub's servers (403) | Medium | Same as above | Run the updater from your PC (below) |
| New FC release (FC 28) | Certain, once a year | Club ID changes; banner + warning in `status.json` | Search the club, update `clubId` in `config.json` |
| More than 10 league matches played while the updater is down | Low | Blue "may be missing" banner | Nothing to do — those matches are unrecoverable (career totals still update) |
| GitHub pauses the schedule in a quiet repo | Low | Banner | The workflow re-enables itself every run; if it ever stops, click *Enable workflow* in Actions |

### If EA blocks the updater
Run it from your PC instead (home internet connections aren't blocked). Install Node.js 22+, clone the repo, then:
```
npm ci
git worktree add data-branch data
set "DATA_DIR=data-branch"
npm run poll
cd data-branch && git add -A && git commit -m "data" && git push
```
Use Windows Task Scheduler to run it every few hours.

### Each new FC release
1. Find the new club ID: `https://proclubs.ea.com/api/fc/allTimeLeaderboard/search?platform=common-gen5&clubName=MADRAS%20%20FC`
2. Put it in `config.json` → `clubId`, push. History from the old game stays in the data branch.

## Local preview
```
npm ci
node scripts/make-preview-data.mjs   # sample data built from real Madras FC matches
node scripts/serve.mjs               # then open http://localhost:8080/site/?data=/data-preview/demo/
npm test                             # 16 tests
```

## Not included (yet)
- Dribbles / distance: EA doesn't publish them. Each match's raw event codes are saved in `events.json` so they can be decoded later.
- Friendlies are not tracked (add `"friendlyMatch"` to `matchTypes` in `config.json` to include them).

Data comes from EA's unofficial Pro Clubs endpoints. Not affiliated with or endorsed by EA.
