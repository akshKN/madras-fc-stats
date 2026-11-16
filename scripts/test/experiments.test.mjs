import test from 'node:test';
import assert from 'node:assert/strict';
import * as X from '../../site/experiments.js';

const TZ = 'America/Chicago';
const ts = (iso) => Date.parse(iso) / 1000;
const M = (iso, result, gf, ga) => ({ id: iso, ts: ts(iso), result, gf, ga, opp: { name: 'X' }, players: [{ name: 'a', sec: 5400, rt: 7 }] });

test('localDate uses the club time zone, not UTC', () => {
  assert.equal(X.localDate(ts('2026-11-16T03:30:00Z'), TZ), '2026-11-15'); // 9:30 PM Central the day before
});

test('clean validates and normalises', () => {
  assert.throws(() => X.clean({ name: ' ', start: '2026-11-17' }), /name/);
  assert.throws(() => X.clean({ name: 'x', start: '17/11/2026' }), /start date/);
  assert.throws(() => X.clean({ name: 'x', start: '2026-02-30' }), /start date/);
  assert.throws(() => X.clean({ name: 'x', start: '2026-11-17', end: '2026-11-10' }), /before/);
  const e = X.clean({ name: '  3-5-2 trial ', start: '2026-11-17', outcome: 'bogus' });
  assert.equal(e.name, '3-5-2 trial');
  assert.equal(e.outcome, '');
  assert.ok(e.id);
});

test('parseFile never throws and keeps good entries', () => {
  assert.deepEqual(X.parseFile(null), { list: [], error: null });
  assert.match(X.parseFile({ nope: 1 }).error, /formatting/);
  const r = X.parseFile({ experiments: [{ name: 'ok', start: '2026-11-17' }, { name: '', start: 'bad' }] });
  assert.equal(r.list.length, 1);
  assert.match(r.error, /skipped/);
});

test('serialize round-trips through parseFile', () => {
  const list = [X.clean({ id: 'a', name: 'One', start: '2026-11-17', formation: '3-5-2' })];
  assert.deepEqual(X.parseFile(JSON.parse(X.serialize(list))).list, list);
});

test('evaluate splits matches by local date and compares with the games before', () => {
  const matches = [
    M('2026-11-14T02:00:00Z', 'L', 0, 2), // Nov 13 local → before
    M('2026-11-15T02:00:00Z', 'L', 1, 2), // Nov 14 local → before
    M('2026-11-16T03:30:00Z', 'W', 3, 0), // Nov 15 local → during
    M('2026-11-16T20:00:00Z', 'W', 2, 1), // Nov 16 local → during
    M('2026-11-18T20:00:00Z', 'D', 1, 1), // Nov 18 local → after the end date
  ];
  const r = X.evaluate({ start: '2026-11-15', end: '2026-11-16' }, matches, TZ);
  assert.equal(r.during.n, 2);
  assert.equal(r.baseline.n, 2);
  assert.equal(r.delta.winPct, 1);
  assert.equal(r.delta.gfPer, 2);
  assert.equal(r.active, false);
  assert.equal(r.lowSample, true);
  const open = X.evaluate({ start: '2026-11-15', end: '' }, matches, TZ);
  assert.equal(open.during.n, 3);
  assert.equal(open.active, true);
  assert.equal(X.evaluate({ start: '2026-12-01', end: '' }, matches, TZ).delta.winPct, null); // no games yet → no delta
});

// --- fake GitHub ---
function fakeGitHub({ file = null, failPutOnce = 0, putStatus = 200, getStatus = null } = {}) {
  const state = { file, sha: file ? 's1' : null, puts: [], auth: [] };
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const fetchFn = async (url, init = {}) => {
    state.auth.push(init.headers?.Authorization);
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body);
      if (failPutOnce-- > 0) return res(409, {});
      if (putStatus !== 200) return res(putStatus, {});
      if ((state.sha || undefined) !== body.sha) return res(409, {});
      state.file = Buffer.from(body.content, 'base64').toString('utf8'); state.sha = 's' + (state.puts.length + 2); state.puts.push(body);
      return res(200, {});
    }
    if (getStatus) return res(getStatus, {});
    if (state.file == null) return res(404, {});
    return res(200, { sha: state.sha, content: Buffer.from(state.file).toString('base64') });
  };
  return { state, opts: { token: 'tok', repo: 'o/r', path: 'experiments.json', fetchFn } };
}
const entry = X.clean({ id: 'a', name: 'Trial — 3-5-2 ⚽', start: '2026-11-17' });

test('save creates the file when missing, with auth header and no sha', async () => {
  const gh = fakeGitHub();
  const list = await X.saveExperiments(gh.opts, (l) => X.upsert(l, entry), 'Add');
  assert.equal(list.length, 1);
  assert.equal(gh.state.puts[0].sha, undefined);
  assert.equal(gh.state.puts[0].branch, 'main');
  assert.equal(gh.state.auth[0], 'Bearer tok');
  assert.equal(X.parseFile(JSON.parse(gh.state.file)).list[0].name, 'Trial — 3-5-2 ⚽'); // unicode survives base64
});

test('save updates an existing file and keeps other entries', async () => {
  const other = X.clean({ id: 'b', name: 'Other', start: '2026-11-10' });
  const gh = fakeGitHub({ file: X.serialize([other]) });
  await X.saveExperiments(gh.opts, (l) => X.upsert(l, entry));
  assert.equal(gh.state.puts[0].sha, 's1');
  assert.deepEqual(X.parseFile(JSON.parse(gh.state.file)).list.map((x) => x.id), ['b', 'a']);
  await X.saveExperiments(gh.opts, (l) => X.remove(l, 'b'));
  assert.deepEqual(X.parseFile(JSON.parse(gh.state.file)).list.map((x) => x.id), ['a']);
});

test('save retries once on a conflict, then gives up politely', async () => {
  const gh = fakeGitHub({ failPutOnce: 1 });
  assert.equal((await X.saveExperiments(gh.opts, (l) => X.upsert(l, entry))).length, 1);
  const gh2 = fakeGitHub({ failPutOnce: 5 });
  await assert.rejects(X.saveExperiments(gh2.opts, (l) => X.upsert(l, entry)), /Try again/);
});

test('save never overwrites a broken file, and explains token problems', async () => {
  const broken = fakeGitHub({ file: '{ not json' });
  await assert.rejects(X.saveExperiments(broken.opts, (l) => X.upsert(l, entry)), /formatting error/);
  assert.equal(broken.state.puts.length, 0);
  await assert.rejects(X.saveExperiments(fakeGitHub({ getStatus: 401 }).opts, (l) => l), /expired/);
  await assert.rejects(X.saveExperiments(fakeGitHub({ putStatus: 403 }).opts, (l) => X.upsert(l, entry)), /Contents: Read and write/);
  const down = { token: 't', repo: 'o/r', path: 'p', fetchFn: async () => { throw new TypeError('offline'); } };
  await assert.rejects(X.saveExperiments(down, (l) => l), /connection/);
});

test('checkToken explains each failure', async () => {
  const mk = (status, body = {}) => ({ token: 't', repo: 'o/r', fetchFn: async () => ({ ok: status < 300, status, json: async () => body }) });
  await assert.rejects(X.checkToken({ token: '', repo: 'o/r' }), /Paste/);
  await assert.rejects(X.checkToken(mk(401)), /didn’t accept/);
  await assert.rejects(X.checkToken(mk(404)), /can’t see/);
  await assert.rejects(X.checkToken(mk(200, { permissions: { push: false } })), /collaborator/);
  assert.equal(await X.checkToken(mk(200, { permissions: { push: true } })), true);
});
