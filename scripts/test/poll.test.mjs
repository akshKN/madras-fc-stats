import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../poll.mjs';
import { normalizeMatch, mergeMatches } from '../lib/normalize.mjs';
import { eaGet } from '../lib/ea.mjs';
import { CLUB, config, fakeFetchers, rawLeague } from './helpers.mjs';

const tmp = () => mkdtemp(path.join(os.tmpdir(), 'mfc-'));
const read = async (d, f) => JSON.parse(await readFile(path.join(d, f), 'utf8'));
const quiet = () => {};

test('normalizes results, including forfeits', () => {
  const raw = rawLeague();
  const byOpp = Object.fromEntries(raw.map((m) => {
    const n = normalizeMatch(m, CLUB, 'league');
    return [n.opp.name, n];
  }));
  assert.equal(byOpp['TVPA AMERICA'].result, 'W'); // 2-0
  assert.equal(byOpp['GVNG 97'].result, 'L'); // 1-6
  assert.equal(byOpp['church soccer'].result, 'W'); // opponent quit
  assert.equal(byOpp['church soccer'].dnf, 'them');
  assert.equal(byOpp['CubanPr'].result, 'L'); // we quit
  assert.equal(byOpp['CubanPr'].dnf, 'us');
  const kart = byOpp['church soccer'].players.find((p) => p.name === 'kartiyksn');
  assert.deepEqual([kart.g, kart.rt, kart.mom, kart.tm, kart.ta], [3, 9.7, 1, 4, 5]);
});

test('first run saves all 10 matches and every data file', async () => {
  const d = await tmp();
  const res = await run({ config, dataDir: d, fetchers: fakeFetchers(), now: Date.UTC(2026, 10, 14, 22), log: quiet });
  assert.equal(res.ok, true);
  assert.equal(res.newMatches, 10);
  assert.equal((await read(d, 'matches.json')).length, 10);
  assert.equal((await read(d, 'members.json')).length, 9);
  const club = await read(d, 'club.json');
  assert.equal(club.currentDivision, 3, 'uses the current-season division, not the stale all-time one');
  assert.deepEqual([club.season.wins, club.season.ties, club.season.losses, club.season.points], [43, 15, 39, 40]);
  assert.deepEqual(await read(d, 'snapshots/index.json'), ['2026-11-14']);
  const st = await read(d, 'status.json');
  assert.equal(st.ok, true);
  assert.equal(st.matchCount, 10);
});

test('second run with the same data adds nothing and writes no new snapshot', async () => {
  const d = await tmp();
  await run({ config, dataDir: d, fetchers: fakeFetchers(), now: Date.UTC(2026, 10, 14), log: quiet });
  const res = await run({ config, dataDir: d, fetchers: fakeFetchers(), now: Date.UTC(2026, 10, 16), log: quiet });
  assert.equal(res.newMatches, 0);
  assert.equal((await readdir(path.join(d, 'snapshots'))).length, 2); // index + one day
});

test('keeps old matches after they fall out of EA\'s 10-match window', async () => {
  const d = await tmp();
  const all = rawLeague();
  await run({ config, dataDir: d, fetchers: fakeFetchers({ league: all.slice(5) }), log: quiet });
  await run({ config, dataDir: d, fetchers: fakeFetchers({ league: all.slice(0, 5) }), log: quiet });
  const saved = await read(d, 'matches.json');
  assert.equal(saved.length, 10);
  assert.ok(saved[0].ts >= saved[9].ts, 'sorted newest first');
});

test('flags a gap when EA\'s window no longer overlaps what we saved', () => {
  const old = [{ id: 'a', ts: 100, type: 'league' }];
  const fresh = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, ts: 200 + i, type: 'league' }));
  const res = mergeMatches(old, fresh, 'league');
  assert.deepEqual(res.gap, { type: 'league', from: 100, to: 200 });
  assert.equal(mergeMatches(old, fresh.slice(0, 3), 'league').gap, null);
});

test('EA outage: run fails (so GitHub emails you) but saved history is untouched', async () => {
  const d = await tmp();
  await run({ config, dataDir: d, fetchers: fakeFetchers(), log: quiet });
  const res = await run({ config, dataDir: d, fetchers: fakeFetchers({ fail: { matches: true, members: true, overall: true } }), log: quiet });
  assert.equal(res.ok, false);
  assert.equal((await read(d, 'matches.json')).length, 10);
  const st = await read(d, 'status.json');
  assert.equal(st.ok, false);
  assert.ok(st.errors.length >= 3);
  assert.ok(st.lastSuccess < st.lastRun);
});

test('warns if the club ID no longer matches the club name', async () => {
  const d = await tmp();
  const f = fakeFetchers();
  f.search = async () => [{ clubId: '999', currentDivision: '3', clubInfo: { name: 'MADRAS  FC' } }];
  f.seasonSearch = async () => [{ clubId: '999', currentDivision: '3', clubInfo: { name: 'MADRAS  FC' } }];
  const res = await run({ config, dataDir: d, fetchers: f, log: quiet });
  assert.ok(res.warnings.some((w) => w.includes('Club ID not found')));
});

test('eaGet retries a 403 then succeeds on the next transport', async () => {
  let calls = 0;
  const transportList = [
    { name: 'a', fetch: async () => { calls++; return new Response('blocked', { status: 403 }); } },
    { name: 'b', fetch: async () => { calls++; return new Response('[1,2]', { status: 200 }); } },
  ];
  const out = await eaGet('x', {}, { transportList, sleep: async () => {} });
  assert.deepEqual(out, [1, 2]);
  assert.equal(calls, 2);
});

test('eaGet gives up immediately on a 400 (bad request, not worth retrying)', async () => {
  let calls = 0;
  const transportList = [{ name: 'a', fetch: async () => { calls++; return new Response('bad', { status: 400 }); } }];
  await assert.rejects(eaGet('x', {}, { transportList, sleep: async () => {} }), /HTTP 400/);
  assert.equal(calls, 1);
});

test('falls back to the all-time division if the season leaderboard is unavailable', async () => {
  const d = await tmp();
  await run({ config, dataDir: d, fetchers: fakeFetchers({ fail: { seasonSearch: true } }), log: quiet });
  const club = await read(d, 'club.json');
  assert.equal(club.currentDivision, 8);
  assert.equal(club.season, null);
});
