// Fetches Madras FC's latest data from EA and saves it as JSON.
// Run: DATA_DIR=path node scripts/poll.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { endpoints } from './lib/ea.mjs';
import { normalizeMatch, extractEvents, mergeMatches, normalizeMembers, localDate } from './lib/normalize.mjs';

const TYPE_LABEL = { leagueMatch: 'league', playoffMatch: 'playoff', friendlyMatch: 'friendly' };

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Write only when content actually changed. Returns true if written. */
async function writeIfChanged(file, data) {
  const next = JSON.stringify(data, null, 1) + '\n';
  const prev = existsSync(file) ? await readFile(file, 'utf8') : null;
  if (prev === next) return false;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, next);
  return true;
}

function realFetchers(log) {
  const opts = { log };
  return {
    matches: (c, type) => endpoints.matches(c.platform, c.clubId, type, opts),
    members: (c) => endpoints.members(c.platform, c.clubId, opts),
    overall: (c) => endpoints.overall(c.platform, c.clubId, opts),
    search: (c) => endpoints.search(c.platform, c.clubName.trim(), opts),
    seasonSearch: (c) => endpoints.seasonSearch(c.platform, c.clubName.trim(), opts),
  };
}

export async function run({ config, dataDir, fetchers, now = Date.now(), log = console.log }) {
  const f = (name) => path.join(dataDir, name);
  const errors = [];
  const warnings = [];
  const status = await readJson(f('status.json'), { gaps: [] });
  let matches = await readJson(f('matches.json'), []);
  const events = await readJson(f('events.json'), {});
  let changed = false;
  let leagueOk = false;
  let newMatches = 0;

  // 1. Matches (the important part — EA only keeps the last 10 of each type)
  for (const type of config.matchTypes) {
    const label = TYPE_LABEL[type] ?? type;
    try {
      const raw = await fetchers.matches(config, type);
      if (!Array.isArray(raw)) throw new Error(`unexpected response shape for ${type}`);
      const fresh = raw.map((m) => normalizeMatch(m, config.clubId, label));
      for (const m of raw) {
        const ev = extractEvents(m, config.clubId);
        if (Object.keys(ev).length) events[String(m.matchId)] = ev;
      }
      const res = mergeMatches(matches, fresh, label);
      matches = res.matches;
      newMatches += res.added;
      if (res.gap) {
        status.gaps = [...(status.gaps || []), { ...res.gap, detectedAt: now }].slice(-20);
        warnings.push(`Possible missed ${label} matches between ${new Date(res.gap.from * 1000).toISOString()} and ${new Date(res.gap.to * 1000).toISOString()}`);
      }
      if (type === 'leagueMatch') leagueOk = true;
      log(`${label}: ${fresh.length} fetched, ${res.added} new`);
    } catch (err) {
      errors.push(`${label} matches: ${err.message}`);
    }
  }
  if (await writeIfChanged(f('matches.json'), matches)) changed = true;
  if (await writeIfChanged(f('events.json'), events)) changed = true;

  // 2. Career totals per member + a dated snapshot whenever they change (for week-over-week)
  try {
    const members = normalizeMembers(await fetchers.members(config));
    if (!members.length) throw new Error('no members returned');
    if (await writeIfChanged(f('members.json'), members)) {
      changed = true;
      const day = localDate(now, config.timeZone);
      await writeIfChanged(f(`snapshots/${day}.json`), members);
      const index = await readJson(f('snapshots/index.json'), []);
      if (!index.includes(day)) index.push(day);
      await writeIfChanged(f('snapshots/index.json'), index.sort());
    }
  } catch (err) {
    errors.push(`members: ${err.message}`);
  }

  // 3. Club totals + current division, and a sanity check that the club ID still matches the name
  try {
    const [overallRaw, search, seasonSearch] = await Promise.all([
      fetchers.overall(config),
      fetchers.search(config).catch(() => null),
      (fetchers.seasonSearch ? fetchers.seasonSearch(config) : Promise.resolve(null)).catch(() => null),
    ]);
    const overall = Array.isArray(overallRaw) ? overallRaw[0] : null;
    if (!overall) throw new Error('no overall stats returned');
    const find = (list) => (Array.isArray(list) ? list.find((c) => String(c.clubId) === String(config.clubId)) : null);
    const hit = find(search);
    const seasonHit = find(seasonSearch);
    if (Array.isArray(search) && Array.isArray(seasonSearch) && !hit && !seasonHit) {
      warnings.push('Club ID not found when searching by club name — the name or ID may have changed');
    }
    const n = (v) => (v == null || v === '' ? null : Number(v));
    const club = {
      clubId: config.clubId,
      name: seasonHit?.clubInfo?.name ?? hit?.clubInfo?.name ?? config.clubName,
      // Prefer the current-season leaderboard; the all-time one can be stale.
      currentDivision: n(seasonHit?.currentDivision) ?? n(hit?.currentDivision),
      season: seasonHit
        ? {
            division: n(seasonHit.currentDivision), bestDivision: n(seasonHit.bestDivision),
            wins: n(seasonHit.wins), ties: n(seasonHit.ties), losses: n(seasonHit.losses),
            points: n(seasonHit.points), games: n(seasonHit.gamesPlayed), goals: n(seasonHit.goals),
            goalsAgainst: n(seasonHit.goalsAgainst), promotions: n(seasonHit.promotions), relegations: n(seasonHit.relegations),
          }
        : null,
      overall: Object.fromEntries(Object.entries(overall).filter(([k]) => !/^last(Match|Opponent)\d/.test(k))),
    };
    if (await writeIfChanged(f('club.json'), club)) changed = true;
  } catch (err) {
    errors.push(`club: ${err.message}`);
  }

  // 4. Status (the website shows a warning if updates stop)
  Object.assign(status, {
    lastRun: now,
    ok: errors.length === 0,
    errors,
    warnings,
    ...(errors.length === 0 ? { lastSuccess: now } : {}),
    ...(changed ? { lastChange: now } : {}),
    ...(newMatches ? { lastNewMatch: now } : {}),
    matchCount: matches.length,
  });
  await writeIfChanged(f('status.json'), status);

  return { ok: leagueOk, errors, warnings, newMatches, changed };
}

// CLI entry
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const config = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'));
  const dataDir = process.env.DATA_DIR || path.join(root, 'data-out');
  const res = await run({ config, dataDir, fetchers: realFetchers(console.log) });
  for (const w of res.warnings) console.warn('WARNING:', w);
  for (const e of res.errors) console.error('ERROR:', e);
  console.log(`done: ${res.newMatches} new match(es), changed=${res.changed}`);
  // Fail the run (so GitHub emails you) if we couldn't get league matches.
  process.exit(res.ok ? 0 : 1);
}
