// Tactical experiments: pure helpers + a tiny GitHub client that saves experiments.json.
import * as S from './stats.js';

export const FORMATIONS = ['4-3-3', '4-2-3-1', '4-4-2', '4-1-2-1-2', '3-5-2', '5-3-2', '3-4-3'];
export const OUTCOMES = { keep: 'Kept it', drop: 'Dropped it', unsure: 'Undecided' };
const HELP = 'Tactical experiments for the Madras FC stats site. Easiest to edit from the site itself (Analytics > Experiments). Dates are YYYY-MM-DD.';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar date (YYYY-MM-DD) of a unix-seconds timestamp in a time zone. */
export function localDate(tsSeconds, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(tsSeconds * 1000)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const realDate = (s) => DATE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

/** Read the file's JSON. Never throws: a broken file gives { list: [], error }. */
export function parseFile(json) {
  if (json == null) return { list: [], error: null };
  const arr = Array.isArray(json) ? json : json.experiments;
  if (!Array.isArray(arr)) return { list: [], error: 'The experiments file has a formatting error.' };
  const list = [];
  for (const e of arr) { try { list.push(clean(e)); } catch { /* skip a bad entry, keep the rest */ } }
  return { list, error: list.length < arr.length ? 'Some experiments were skipped because of formatting errors.' : null };
}

/** Validate + normalise one entry. Throws an Error with a plain-English message. */
export function clean(e) {
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  const out = {
    id: str(e?.id, 40) || newId(),
    name: str(e?.name, 60),
    start: str(e?.start, 10),
    formation: str(e?.formation, 20),
    change: str(e?.change, 240),
    expect: str(e?.expect, 240),
    end: str(e?.end, 10),
    outcome: str(e?.outcome, 10),
    verdict: str(e?.verdict, 240),
  };
  if (!out.name) throw new Error('Give the experiment a name.');
  if (!realDate(out.start)) throw new Error('Pick a start date.');
  if (out.end && !realDate(out.end)) throw new Error('The end date isn’t a valid date.');
  if (out.end && out.end < out.start) throw new Error('The end date is before the start date.');
  if (out.outcome && !OUTCOMES[out.outcome]) out.outcome = '';
  return out;
}

export const newId = () => 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const upsert = (list, entry) => (list.some((x) => x.id === entry.id) ? list.map((x) => (x.id === entry.id ? entry : x)) : [...list, entry]);
export const remove = (list, id) => list.filter((x) => x.id !== id);
export const serialize = (list) => JSON.stringify({ _help: HELP, experiments: list }, null, 2) + '\n';

/** Results while the experiment ran, against the (up to) 10 matches before it started. */
export function evaluate(exp, matches, timeZone) {
  const dated = matches.map((m) => ({ m, d: localDate(m.ts, timeZone) }));
  const inWin = dated.filter(({ d }) => d >= exp.start && (!exp.end || d <= exp.end)).map((x) => x.m);
  const before = dated.filter(({ d }) => d < exp.start).map((x) => x.m).sort((a, b) => b.ts - a.ts).slice(0, 10);
  const during = S.summarize(inWin), baseline = S.summarize(before);
  const diff = (k) => (during[k] != null && baseline[k] != null && during.n && baseline.n ? during[k] - baseline[k] : null);
  return {
    during, baseline, active: !exp.end, lowSample: during.n < 5,
    delta: { winPct: diff('winPct'), gfPer: diff('gfPer'), gaPer: diff('gaPer'), rating: diff('rating') },
  };
}

/* ---------- GitHub (browser → api.github.com, using the editor's own access token) ---------- */
const API = 'https://api.github.com';
const b64encode = (text) => { let s = ''; for (const b of new TextEncoder().encode(text)) s += String.fromCharCode(b); return btoa(s); };
const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(String(b64).replace(/\s/g, '')), (c) => c.charCodeAt(0)));
const headers = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
const MSG = {
  auth: 'GitHub didn’t accept the access token — it may have expired. Open Editor setup and paste a new one.',
  perm: 'This access token can’t edit the repo. It needs “Contents: Read and write” on madras-fc-stats.',
  net: 'Couldn’t reach GitHub. Check your connection and try again.',
  busy: 'Someone else saved at the same moment. Try again.',
  broken: 'The experiments file on GitHub has a formatting error, so nothing was saved. Fix or delete the file on GitHub first.',
};
async function call(fetchFn, url, init) {
  try { return await fetchFn(url, init); } catch { throw new Error(MSG.net); }
}

/** Token template links: fine-grained for the repo owner, classic for a collaborator. */
export function tokenUrls() {
  const q = new URLSearchParams({ name: 'Madras FC experiments', description: 'Lets the Madras FC stats site save experiments', expires_in: '366', contents: 'write' });
  return {
    owner: `https://github.com/settings/personal-access-tokens/new?${q}`,
    collaborator: 'https://github.com/settings/tokens/new?scopes=public_repo&description=Madras+FC+experiments',
  };
}

export async function checkToken({ token, repo, fetchFn = fetch }) {
  if (!token) throw new Error('Paste the access token first.');
  const r = await call(fetchFn, `${API}/repos/${repo}`, { headers: headers(token), cache: 'no-store' });
  if (r.status === 401) throw new Error('GitHub didn’t accept that token. Copy it again and paste the whole thing.');
  if (!r.ok) throw new Error('That token can’t see the madras-fc-stats repo. Check the repository you picked in step 2.');
  const j = await r.json();
  if (j.permissions && j.permissions.push === false) throw new Error('This GitHub account can’t edit the repo yet. Ask AkshKN to add you as a collaborator.');
  return true;
}

export async function loadExperiments({ token, repo, path, branch = 'main', fetchFn = fetch }) {
  const r = await call(fetchFn, `${API}/repos/${repo}/contents/${path}?ref=${branch}`, { headers: headers(token), cache: 'no-store' });
  if (r.status === 404) return { list: [], error: null, sha: null };
  if (r.status === 401) throw new Error(MSG.auth);
  if (!r.ok) throw new Error(MSG.perm);
  const j = await r.json();
  let parsed;
  try { parsed = parseFile(JSON.parse(b64decode(j.content))); } catch { parsed = { list: [], error: MSG.broken }; }
  return { ...parsed, sha: j.sha };
}

/** Read the latest file, apply `mutate(list) → list`, write it back. Retries once if someone else saved in between. */
export async function saveExperiments(opts, mutate, message = 'Update experiments') {
  const { token, repo, path, branch = 'main', fetchFn = fetch } = opts;
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await loadExperiments(opts);
    if (cur.error) throw new Error(MSG.broken);
    const next = mutate(cur.list).map(clean);
    const r = await call(fetchFn, `${API}/repos/${repo}/contents/${path}`, {
      method: 'PUT', headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, branch, content: b64encode(serialize(next)), ...(cur.sha ? { sha: cur.sha } : {}) }),
    });
    if (r.ok) return next;
    if (r.status === 401) throw new Error(MSG.auth);
    if (r.status === 409 || r.status === 422) continue;
    throw new Error(MSG.perm);
  }
  throw new Error(MSG.busy);
}
