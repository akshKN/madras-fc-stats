import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCodes, advancedTable, SOURCE, EXPLAIN } from '../../site/events.js';

test('parses event codes across buckets and ignores junk', () => {
  assert.deepEqual(parseCodes('215:21,30:8,,97:2'), { 215: 21, 30: 8, 97: 2 });
  assert.deepEqual(parseCodes('97:2,97:3'), { 97: 5 });
  assert.deepEqual(parseCodes(''), {});
  assert.deepEqual(parseCodes('abc,5:'), {});
});

// KRRN96 vs Warframe (2026-11-15) — real EA data, checked against the in-game Player Performance screen.
const KRRN = { name: 'KRRN96', pos: 'forward', g: 3, a: 0, sh: 6, pm: 5, pa: 8, tm: 3, ta: 4, rt: 9.7, mom: 1, rc: 0, sv: 0, gc: 0, sec: 3626 };
const KRRN_CODES = '0:3,1:1,100:1,109:1,110:1,111:25,112:7,114:1,121:3,124:1,13:4,131:2,137:1,14:1,141:1,143:2,151:1,152:1,158:1,164:3,174:11,175:5,176:3,177:3,182:1,183:1,186:2,188:1,19:1,193:1,195:1,197:1,202:2,21:1,212:1,214:3,215:5,216:3,217:4,218:2,219:1,229:3,24:5,25:2,29:1,30:1,31:2,32:2,34:2,35:1,93:1,97:11';
const match = { id: 'w', ts: 1, gf: 3, ga: 0, result: 'W', players: [KRRN, { name: 'bench', sec: 0 }] };
const events = { w: { KRRN96: KRRN_CODES } };

test('decodes KRRN96 vs Warframe consistently with the in-game screen', () => {
  const [r] = advancedTable([match], events);
  assert.equal(r.goals, 3);
  assert.equal(r.shots, 6);
  assert.equal(r.passesCompleted, 5);
  assert.equal(r.passesAttempted, 8);
  assert.equal(r.dribblesCompleted, 11); // screen: 12 dribbles, 92% success → 11
  assert.equal(r.tacklesWon, 3);
  assert.equal(r.tacklesAttempted, 4);
  assert.equal(r.fwdCompleted, 1);
  assert.equal(r.throughBalls, 1);
  assert.equal(r.dispossessed, 1);
  assert.equal(r.beatTotal, 7);
  assert.equal(r.inBoxShare, 5 / 6);
});

test('per-90 uses actual minutes, and players with no game time are skipped', () => {
  const rows = advancedTable([match], events);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.ok(Math.abs(r.goalsPer90 - 3 / (3626 / 5400)) < 1e-9);
  assert.equal(r.lowSample, true);
});

test('stats that disagreed with the game screen are flagged unverified', () => {
  for (const k of ['shotsOnTarget', 'shotAcc', 'possLost', 'possWon', 'possLostDef', 'possWonAtt']) assert.equal(SOURCE[k], 'unverified', k);
  for (const k of ['goals', 'passPct', 'tacklePct']) assert.equal(SOURCE[k], 'ea', k);
  assert.equal(SOURCE.dribblesCompleted, 'decoded');
});

test('every stat shown has a source tier', () => {
  for (const k of Object.keys(EXPLAIN)) assert.ok(SOURCE[k], `missing source for ${k}`);
});

test('missing events for a match are skipped, not counted as zeros', () => {
  const rows = advancedTable([match], {});
  assert.equal(rows.length, 0);
});
