// Fetches Madras FC's latest data from EA and saves it as JSON.
// Run: DATA_DIR=path node scripts/poll.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { endpoints } from './lib/ea.mjs';
import { normalizeMatch, extractEvents, mergeMatches, normalizeMembers, localDate } from './lib/normalize.mjs';

const SKILL_MAX_AGE_S = 14 * 86400; // only look up ratings for recent matches — an old match's rating has drifted
const SKILL_LOOKUPS_PER_RUN = 12;
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
    opponent: (c, clubId) => endpoints.overall(c.platform, clubId, opts),
    // Probing guessed match types: one quick try each, since EA errors out on names it doesn't know.
    probe: (c, type) => endpoints.matches(c.platform, c.clubId, type, { log, retries: 1 }),
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
  let rawSaved = 0;
  let ourSkill = null;

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
        // Keep EA's full response for each match, untouched, in case we want more out of it later.
        const rawFile = f(`raw/${label}/${m.matchId}.json`);
        if (m.matchId != null && !existsSync(rawFile)) {
          try { await mkdir(path.dirname(rawFile), { recursive: true }); await writeFile(rawFile, JSON.stringify(m) + '\n'); changed = true; rawSaved++; }
          catch (err) { warnings.push(`could not save raw match ${m.matchId}: ${err.message}`); }
        }
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

  // 1b. Probe: ask EA about extra match types (live events, cups, ...) and record what comes back.
  //     Findings only — nothing found here is added to the match history. A failure is never an error.
  if (fetchers.probe && config.probeTypes?.length) {
    try {
      const results = {};
      for (const type of config.probeTypes) {
        try {
          const raw = await fetchers.probe(config, type);
          if (!Array.isArray(raw)) { results[type] = { status: 'unexpected shape', sample: JSON.stringify(raw).slice(0, 200) }; continue; }
          const own = new Set(matches.map((m) => String(m.id)));
          results[type] = {
            status: 'ok',
            count: raw.length,
            matchTypesSeen: [...new Set(raw.map((m) => String(m.matchType)))],
            alreadyInHistory: raw.filter((m) => own.has(String(m.matchId))).length,
            newest: raw.length ? Math.max(...raw.map((m) => Number(m.timestamp) || 0)) : null,
          };
          for (const m of raw.slice(0, 3)) {
            const file = f(`probe/${type}/${m.matchId}.json`);
            if (m.matchId != null && !existsSync(file)) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(m) + '\n'); changed = true; }
          }
          log(`probe ${type}: ${raw.length} returned`);
        } catch (err) {
          results[type] = { status: 'error', message: String(err.message).slice(0, 160) };
          log(`probe ${type}: ${results[type].message}`);
        }
      }
      const prev = await readJson(f('probe.json'), {});
      if (JSON.stringify(prev.results) !== JSON.stringify(results)) {
        await writeFile(f('probe.json'), JSON.stringify({ at: new Date(now).toISOString(), results }, null, 1) + '\n');
        changed = true;
      }
    } catch (err) {
      warnings.push(`probe failed: ${err.message}`);
    }
  }

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
    ourSkill = n(overall.skillRating) || null;
  } catch (err) {
    errors.push(`club: ${err.message}`);
  }

  // 4. Skill ratings: ours and each recent opponent's, as close to match time as we can get.
  //    Best effort — a failure here is only a warning and never blocks the match history.
  let skillsAdded = 0;
  if (fetchers.opponent) {
    const nowS = Math.floor(now / 1000);
    const recent = matches.filter((m) => m.opp?.id && nowS - m.ts <= SKILL_MAX_AGE_S);
    const wanted = [...new Set(recent.filter((m) => m.opp.skill == null).map((m) => m.opp.id))].slice(0, SKILL_LOOKUPS_PER_RUN);
    const found = new Map();
    let failed = 0;
    for (const id of wanted) {
      try {
        const res = await fetchers.opponent(config, id);
        const skill = Number((Array.isArray(res) ? res[0] : null)?.skillRating);
        if (Number.isFinite(skill) && skill > 0) found.set(id, skill);
      } catch { failed++; }
    }
    if (failed) warnings.push(`could not look up ${failed} opponent rating(s) — will retry next run`);
    for (const m of recent) {
      if (m.opp.skill == null && found.has(m.opp.id)) { m.opp.skill = found.get(m.opp.id); m.opp.skillTs = nowS; skillsAdded++; }
      if (m.ourSkill == null && ourSkill) m.ourSkill = ourSkill;
    }
    if (await writeIfChanged(f('matches.json'), matches)) changed = true;
    if (wanted.length) log(`opponent ratings: ${found.size}/${wanted.length} found`);
  }

  // 5. Status (the website shows a warning if updates stop)
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

  return { ok: leagueOk, errors, warnings, newMatches, changed, rawSaved, skillsAdded };
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
