// Pure analytics for the Analytics tab: player comparison + team splits.
import * as S from './stats.js';
import * as E from './events.js';

const played = (p) => p.sec > 0;
const latest = (matches, n) => [...matches].sort((a, b) => b.ts - a.ts).slice(0, n == null || n === 'all' ? Infinity : n);

// metric = [key, label, fmt, higherIsBetter, source]  (source: 'base' | 'adv')
export const METRICS = [
  ['apps', 'Games', 'int', true, 'base'],
  ['rating', 'Avg rating', 'f2', true, 'base'],
  ['winPct', 'Win rate', 'pct', true, 'base'],
  ['g', 'Goals', 'int', true, 'base'],
  ['a', 'Assists', 'int', true, 'base'],
  ['gaPerGame', 'G+A per game', 'f2', true, 'base'],
  ['passPct', 'Pass accuracy', 'pct', true, 'base'],
  ['tacklePct', 'Tackle success', 'pct', true, 'base'],
  ['concededPer90', 'Goals conceded /90', 'f2', false, 'base'],
  ['throughPer90', 'Through balls /90', 'f1', true, 'adv'],
  ['dribblesPer90', 'Dribbles /90', 'f1', true, 'adv'],
  ['interceptionsPer90', 'Interceptions /90', 'f1', true, 'adv'],
  ['conversion', 'Shot conversion', 'pct', true, 'adv'],
];

/** Side-by-side comparison of two players over the club's last `n` matches (or 'all'). */
export function compare(matches, events, a, b, n = 'all') {
  const win = latest(matches, n);
  const base = new Map(S.playerTable(win).map((r) => [r.name, r]));
  const adv = new Map(E.advancedTable(win, events).map((r) => [r.name, r]));
  const get = (name, key, src) => (src === 'adv' ? adv.get(name)?.[key] : base.get(name)?.[key]) ?? null;
  const rows = METRICS.map(([key, label, fmt, hi, src]) => {
    const va = get(a, key, src), vb = get(b, key, src);
    let edge = null;
    if (va != null && vb != null && va !== vb) edge = (va > vb) === hi ? 'a' : 'b';
    return { key, label, fmt, a: va, b: vb, edge };
  });
  return { rows, games: win.length, appsA: base.get(a)?.apps ?? 0, appsB: base.get(b)?.apps ?? 0 };
}

const rec = () => ({ n: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
const add = (r, m) => { r.n++; r[m.result.toLowerCase()]++; r.gf += m.gf; r.ga += m.ga; };
const fin = (r) => ({ ...r, winPct: r.n ? r.w / r.n : null, gdPerGame: r.n ? (r.gf - r.ga) / r.n : null });

/** Results grouped by how many of us were on the pitch. */
export function byHeadcount(matches) {
  const by = new Map();
  for (const m of matches) {
    const k = m.players.filter(played).length;
    if (!k) continue;
    if (!by.has(k)) by.set(k, rec());
    add(by.get(k), m);
  }
  return [...by.entries()].map(([k, r]) => ({ humans: k, ...fin(r) })).sort((x, y) => y.humans - x.humans);
}

/** Best three-player combinations (all three on the pitch). */
export function trios(matches, min = 4) {
  const by = new Map();
  for (const m of matches) {
    const names = m.players.filter(played).map((p) => p.name).sort();
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) for (let k = j + 1; k < names.length; k++) {
      const key = [names[i], names[j], names[k]].join('|');
      if (!by.has(key)) by.set(key, { names: [names[i], names[j], names[k]], ...rec() });
      add(by.get(key), m);
    }
  }
  return [...by.values()].filter((r) => r.n >= min).map(fin)
    .sort((x, y) => y.winPct - x.winPct || y.gdPerGame - x.gdPerGame || y.n - x.n);
}

/** Results split by whether the opponent's skill rating was above or below ours (ratings looked up around match time). */
export function byOpponentStrength(matches) {
  const up = rec(), down = rec();
  let unknown = 0;
  for (const m of matches) {
    if (m.opp?.skill == null || m.ourSkill == null) { unknown++; continue; }
    add(m.opp.skill > m.ourSkill ? up : down, m);
  }
  return { stronger: fin(up), weaker: fin(down), unknown, rated: up.n + down.n };
}

/* ---------- roles: EA reports which line each player played in, per match ---------- */
export const ROLE_ORDER = ['forward', 'midfielder', 'defender', 'goalkeeper'];
// metric = [key, label, fmt]
export const ROLES = {
  forward: { label: 'Forward', plural: 'Forwards', metrics: [['rating', 'Rating', 'f2'], ['goalsPer90', 'Goals /90', 'f2'], ['shotsPer90', 'Shots /90', 'f1'], ['conversion', 'Conversion', 'pct'], ['dribblesPer90', 'Dribbles /90', 'f1'], ['gaPer90', 'G+A /90', 'f2']] },
  midfielder: { label: 'Midfielder', plural: 'Midfielders', metrics: [['rating', 'Rating', 'f2'], ['passPct', 'Pass acc.', 'pct'], ['throughPer90', 'Through /90', 'f1'], ['fwdPct', 'Fwd pass acc.', 'pct'], ['gaPer90', 'G+A /90', 'f2'], ['interceptionsPer90', 'Intercepts /90', 'f1']] },
  defender: { label: 'Defender', plural: 'Defenders', metrics: [['rating', 'Rating', 'f2'], ['tacklePct', 'Tackle success', 'pct'], ['interceptionsPer90', 'Intercepts /90', 'f1'], ['defActionsPer90', 'Def. actions /90', 'f1'], ['concededPer90', 'Conceded /90', 'f2'], ['passPct', 'Pass acc.', 'pct']] },
  goalkeeper: { label: 'Goalkeeper', plural: 'Goalkeepers', metrics: [['rating', 'Rating', 'f2'], ['concededPer90', 'Conceded /90', 'f2'], ['cs', 'Clean sheets', 'int'], ['winPct', 'Win rate', 'pct']] },
};
const SMALL = 5;

/** Per-player stats counting only the matches they played in `role`. EA's own stats win over decoded ones. */
export function roleTable(matches, events, role) {
  const only = matches.map((m) => ({ ...m, players: m.players.filter((p) => p.pos === role && played(p)) })).filter((m) => m.players.length);
  const adv = new Map(E.advancedTable(only, events).map((r) => [r.name, r]));
  return S.playerTable(only).map((b) => ({ ...(adv.get(b.name) || {}), ...b, role, small: b.apps < SMALL }))
    .sort((x, y) => x.small - y.small || (y.rating ?? 0) - (x.rating ?? 0) || y.apps - x.apps);
}

/** Roles that anyone has actually played, most-used first. */
export function rolesPlayed(matches) {
  const n = {};
  for (const m of matches) for (const p of m.players) if (played(p) && ROLES[p.pos]) n[p.pos] = (n[p.pos] || 0) + 1;
  return ROLE_ORDER.filter((r) => n[r]).sort((a, b) => n[b] - n[a]);
}

/** One player's numbers in each role they have played, most-played first. */
export function playerRoles(matches, events, name) {
  return ROLE_ORDER.map((role) => roleTable(matches, events, role).find((r) => r.name === name)).filter(Boolean).sort((a, b) => b.apps - a.apps);
}
