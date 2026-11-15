import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMatch } from '../lib/normalize.mjs';
import { CLUB, rawLeague } from './helpers.mjs';
import {
  weekKey, summarize, playerTable, weeklyAwards, records, partnerships, headToHead, weeklySeries, careerDeltas,
} from '../../site/stats.js';

const TZ = 'America/Chicago';
const matches = rawLeague().map((m) => normalizeMatch(m, CLUB, 'league'));

test('weeks start Monday in Chicago time', () => {
  // Sun 2026-11-15 23:30 Chicago = Mon 05:30 UTC → still the week of Mon Nov 9
  assert.equal(weekKey(Date.UTC(2026, 10, 16, 5, 30) / 1000, TZ), '2026-11-09');
  assert.equal(weekKey(Date.UTC(2026, 10, 16, 7, 0) / 1000, TZ), '2026-11-16');
});

test('season summary matches the real results', () => {
  const s = summarize(matches);
  assert.deepEqual([s.n, s.w, s.d, s.l], [10, 2, 0, 8]);
  assert.equal(s.gf, 15);
  assert.equal(s.ga, 29);
});

test('players who never got on the pitch are not counted', () => {
  const t = playerTable(matches);
  const ld = t.find((r) => r.name === 'LastDance2021');
  assert.equal(ld.apps, 4); // listed in 5 matches, 0 seconds in one
  const kart = t.find((r) => r.name === 'kartiyksn');
  assert.equal(kart.g, 4);
  assert.equal(kart.a, 2);
  assert.ok(kart.passPct > 0.8 && kart.passPct < 0.9);
});

test('weekly awards pick sensible winners', () => {
  const a = Object.fromEntries(weeklyAwards(matches).map((x) => [x.key, x]));
  assert.deepEqual(a.boot.names, ['naveenboltz']); // 6 goals (2+2+1+1)
  assert.equal(a.boot.value, '6 goals');
  assert.deepEqual(a.playmaker.names, ['LastDance2021']); // 5 assists
  assert.deepEqual(a.wall.names, ['kartiyksn', 'KRRN96', 'naveenboltz']); // 12 tackles each — shared
  assert.equal(a.wall.value, '12 tackles');
  assert.ok(!a.improved, 'no previous week → no Most Improved');
});

test('records ignore forfeit scorelines', () => {
  const r = records(matches);
  assert.equal(r.bigWin.opp.name, 'TVPA AMERICA'); // 2-0, not the 5-0 forfeit
  assert.equal(r.bigLoss.opp.name, 'GVNG 97'); // 1-6
  assert.equal(r.bestRating.name, 'kartiyksn');
  assert.equal(r.bestRating.rt, 9.7);
});

test('partnerships and head-to-head', () => {
  const p = partnerships(matches);
  assert.ok(p.length > 0 && p.every((x) => x.n >= 3));
  assert.equal(headToHead(matches).length, 10);
});

test('weekly series and career deltas', () => {
  assert.ok(weeklySeries(matches, TZ).length >= 1);
  const d = careerDeltas(
    [{ name: 'x', gamesPlayed: 12, goals: 5, assists: 1, manOfTheMatch: 1, ratingAve: 7.5 }, { name: 'y', gamesPlayed: 3 }],
    [{ name: 'x', gamesPlayed: 10, goals: 3, assists: 1, manOfTheMatch: 0, ratingAve: 7.3 }, { name: 'y', gamesPlayed: 3 }],
  );
  assert.equal(d.length, 1);
  assert.equal(d[0].goals, 2);
});

test('player profile aggregates tracked, career, best games and milestones', async () => {
  const { playerProfile } = await import('../../site/stats.js');
  const { normalizeMembers } = await import('../lib/normalize.mjs');
  const raw = JSON.parse((await import('node:fs')).readFileSync(new URL('../../fixtures/members.json', import.meta.url)));
  const members = normalizeMembers(raw); // same shape the site reads from members.json
  const p = playerProfile(matches, members, 'kartiyksn');
  assert.equal(p.tracked.g, 4);
  assert.equal(p.career.goals, 86);
  assert.equal(p.ratingSeries.length, p.tracked.apps);
  assert.ok(p.ratingSeries[0].ts < p.ratingSeries.at(-1).ts, 'rating series is chronological');
  assert.equal(p.best[0].rating, 9.7); // best game first
  const goalsM = p.milestones.find((m) => m.key === 'goals');
  assert.equal(goalsM.target, 100); // 86 → next 25-multiple above
  assert.equal(goalsM.toGo, 14);
  assert.ok(p.partners.length > 0 && p.partners.every((x) => x.name !== 'kartiyksn'));
});

test('weekly recap text has results and awards', async () => {
  const { weeklyRecap } = await import('../../site/stats.js');
  const txt = weeklyRecap(matches, { clubName: 'Madras FC', weekLabel: 'This week' });
  assert.match(txt, /Madras FC/);
  assert.match(txt, /\d+W \d+D \d+L/);
  assert.match(txt, /Golden Boot: naveenboltz/);
  assert.match(txt, /church soccer \(forfeit\)/);
});
