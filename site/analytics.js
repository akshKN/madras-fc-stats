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
