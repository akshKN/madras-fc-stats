import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../../site/analytics.js';

const P = (name, sec = 5400, extra = {}) => ({ name, pos: 'midfielder', g: 0, a: 0, sh: 0, pm: 8, pa: 10, tm: 1, ta: 2, rt: 7, mom: 0, rc: 0, gc: 0, sec, ...extra });
const M = (id, ts, result, gf, ga, players) => ({ id, ts, result, gf, ga, opp: { name: 'X' }, players });
const matches = [
  M('1', 100, 'W', 3, 1, [P('a', 5400, { g: 2, rt: 9 }), P('b'), P('c')]),
  M('2', 200, 'L', 0, 2, [P('a', 5400, { rt: 5 }), P('b', 5400, { g: 0, rt: 7 })]),
  M('3', 300, 'W', 2, 0, [P('a'), P('b', 5400, { rt: 8 }), P('c'), P('d', 0)]),
];

test('byHeadcount ignores players with no game time and groups results', () => {
  const r = A.byHeadcount(matches);
  assert.deepEqual(r.map((x) => [x.humans, x.n, x.w, x.l]), [[3, 2, 2, 0], [2, 1, 0, 1]]);
  assert.equal(r[0].winPct, 1);
  assert.equal(r[0].gdPerGame, 2);
});

test('trios needs a minimum sample and counts only full trios', () => {
  assert.equal(A.trios(matches, 3).length, 0);
  const t = A.trios(matches, 2);
  assert.deepEqual(t[0].names, ['a', 'b', 'c']);
  assert.equal(t[0].n, 2);
});

test('compare limits to the last N matches and picks the edge direction', () => {
  const all = A.compare(matches, {}, 'a', 'b', 'all');
  assert.equal(all.rows.find((r) => r.key === 'g').edge, 'a');
  assert.equal(all.rows.find((r) => r.key === 'concededPer90').edge, null); // equal values
  const last1 = A.compare(matches, {}, 'a', 'b', 1);
  assert.equal(last1.games, 1);
  assert.equal(last1.appsA, 1);
  assert.equal(last1.rows.find((r) => r.key === 'rating').edge, 'b'); // 7 vs 8 in the latest match
});

test('compare gives null (not zero) for players with no data in the window', () => {
  const r = A.compare(matches, {}, 'a', 'zed', 'all');
  assert.equal(r.rows.find((x) => x.key === 'rating').b, null);
  assert.equal(r.rows.find((x) => x.key === 'rating').edge, null);
});
