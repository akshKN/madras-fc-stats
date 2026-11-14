// Pure stat calculations — no DOM. Used by app.js and by the tests.

export const FULL_MATCH_SECONDS = 5400; // 90 game minutes
const played = (p) => p.sec > 0;
const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
const ratio = (a, b) => (b > 0 ? a / b : null);

/** Monday (YYYY-MM-DD) of the week containing `tsSeconds`, in the given time zone. */
export function weekKey(tsSeconds, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
      .formatToParts(new Date(tsSeconds * 1000))
      .map((p) => [p.type, p.value]),
  );
  const dow = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[parts.weekday];
  const d = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day - dow));
  return d.toISOString().slice(0, 10);
}

export function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function teamRating(m) {
  const ps = m.players.filter(played);
  return ps.length ? sum(ps, (p) => p.rt) / ps.length : null;
}

export function summarize(matches) {
  const n = matches.length;
  const w = matches.filter((m) => m.result === 'W').length;
  const d = matches.filter((m) => m.result === 'D').length;
  const l = n - w - d;
  const ratings = matches.map(teamRating).filter((r) => r != null);
  return {
    n, w, d, l,
    gf: sum(matches, (m) => m.gf),
    ga: sum(matches, (m) => m.ga),
    winPct: ratio(w, n),
    gfPer: ratio(sum(matches, (m) => m.gf), n),
    gaPer: ratio(sum(matches, (m) => m.ga), n),
    rating: ratings.length ? sum(ratings, (r) => r) / ratings.length : null,
    cleanSheets: matches.filter((m) => m.ga === 0 && !m.dnf).length,
  };
}

/** Per-player totals over a set of matches (only appearances with game time count). */
export function playerTable(matches) {
  const by = new Map();
  for (const m of matches) {
    for (const p of m.players) {
      if (!played(p)) continue;
      const r = by.get(p.name) ?? {
        name: p.name, apps: 0, sec: 0, g: 0, a: 0, sh: 0, pm: 0, pa: 0, tm: 0, ta: 0,
        rtSum: 0, mom: 0, rc: 0, gc: 0, cs: 0, w: 0, d: 0, l: 0, pos: {}, best: null,
      };
      r.apps++; r.sec += p.sec; r.g += p.g; r.a += p.a; r.sh += p.sh; r.pm += p.pm; r.pa += p.pa;
      r.tm += p.tm; r.ta += p.ta; r.rtSum += p.rt; r.mom += p.mom; r.rc += p.rc; r.gc += p.gc;
      r[m.result.toLowerCase()]++;
      if (m.ga === 0 && !m.dnf) r.cs++;
      r.pos[p.pos] = (r.pos[p.pos] || 0) + 1;
      if (!r.best || p.rt > r.best.rt) r.best = { rt: p.rt, matchId: m.id, opp: m.opp.name };
      by.set(p.name, r);
    }
  }
  return [...by.values()].map((r) => ({
    ...r,
    mins: Math.round(r.sec / 60),
    ga_: r.g + r.a,
    gaPerGame: ratio(r.g + r.a, r.apps),
    rating: ratio(r.rtSum, r.apps),
    passPct: ratio(r.pm, r.pa),
    tacklePct: ratio(r.tm, r.ta),
    concededPer90: ratio(r.gc, r.sec / FULL_MATCH_SECONDS),
    winPct: ratio(r.w, r.apps),
    mainPos: Object.entries(r.pos).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '',
  }));
}

export function groupByWeek(matches, timeZone) {
  const weeks = new Map();
  for (const m of matches) {
    const k = weekKey(m.ts, timeZone);
    if (!weeks.has(k)) weeks.set(k, []);
    weeks.get(k).push(m);
  }
  return weeks; // key → matches
}

/** One row per week, oldest first, for trend charts. */
export function weeklySeries(matches, timeZone) {
  return [...groupByWeek(matches, timeZone).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, ms]) => ({ week, ...summarize(ms) }));
}

/** Everyone tied for the top value (awards are shared on a tie). */
function top(rows, value, { min = 0, filter = () => true } = {}) {
  const cands = rows.filter((r) => filter(r) && value(r) != null && value(r) > min);
  if (!cands.length) return null;
  const best = Math.max(...cands.map(value));
  return cands
    .filter((r) => Math.abs(value(r) - best) < 1e-9)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Fun weekly awards. `prev` = previous week's matches (for Most Improved). */
export function weeklyAwards(week, prev = []) {
  const rows = playerTable(week);
  const prevRows = new Map(playerTable(prev).map((r) => [r.name, r]));
  const minApps = week.length >= 4 ? 2 : 1;
  const awards = [];
  const add = (key, title, blurb, winners, fmt) =>
    winners && awards.push({ key, title, blurb, names: winners.map((w) => w.name), value: fmt(winners[0]) });

  add('potw', 'Player of the Week', 'Best average match rating', top(rows, (r) => r.rating, { filter: (r) => r.apps >= minApps }), (r) => `${r.rating.toFixed(2)} avg`);
  add('boot', 'Golden Boot', 'Most goals', top(rows, (r) => r.g), (r) => `${r.g} goal${r.g === 1 ? '' : 's'}`);
  add('playmaker', 'Playmaker', 'Most assists', top(rows, (r) => r.a), (r) => `${r.a} assist${r.a === 1 ? '' : 's'}`);
  add('wall', 'The Wall', 'Most tackles won', top(rows, (r) => r.tm), (r) => `${r.tm} tackles`);
  add('passer', 'Pass Master', 'Best pass completion (30+ attempts)', top(rows, (r) => r.passPct, { filter: (r) => r.pa >= 30 }), (r) => `${Math.round(r.passPct * 100)}%`);
  add('ironman', 'Iron Man', 'Most minutes played', top(rows, (r) => r.mins), (r) => `${r.mins} min`);
  const improved = top(
    rows.map((r) => ({ ...r, delta: prevRows.get(r.name)?.rating != null && r.apps >= minApps ? r.rating - prevRows.get(r.name).rating : null })),
    (r) => r.delta,
  );
  add('improved', 'Most Improved', 'Biggest rating jump vs last week', improved, (r) => `+${r.delta.toFixed(2)}`);
  return awards;
}

function streaks(chrono, pred) {
  let best = 0, cur = 0;
  for (const m of chrono) {
    cur = pred(m) ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return { best, current: cur };
}

export function records(matches) {
  const chrono = [...matches].sort((a, b) => a.ts - b.ts);
  const real = matches.filter((m) => !m.dnf); // forfeits don't count as real scorelines
  const pick = (xs, f) => xs.reduce((b, x) => (b == null || f(x) > f(b) ? x : b), null);
  const bigWin = pick(real.filter((m) => m.gf > m.ga), (m) => m.gf - m.ga + m.gf / 100);
  const bigLoss = pick(real.filter((m) => m.ga > m.gf), (m) => m.ga - m.gf + m.ga / 100);
  const mostGoals = pick(real, (m) => m.gf + m.ga);
  let bestRating = null, mostScored = null;
  for (const m of matches) for (const p of m.players.filter(played)) {
    if (!bestRating || p.rt > bestRating.rt) bestRating = { ...p, m };
    if (p.g > 0 && (!mostScored || p.g > mostScored.g)) mostScored = { ...p, m };
  }
  return {
    bigWin, bigLoss, mostGoals, bestRating, mostScored,
    winStreak: streaks(chrono, (m) => m.result === 'W'),
    unbeaten: streaks(chrono, (m) => m.result !== 'L'),
  };
}

/** Win rate for every pair of players who've played together at least `min` times. */
export function partnerships(matches, min = 3) {
  const pairs = new Map();
  for (const m of matches) {
    const names = m.players.filter(played).map((p) => p.name).sort();
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const k = names[i] + '|' + names[j];
      const r = pairs.get(k) ?? { a: names[i], b: names[j], n: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
      r.n++; r[m.result.toLowerCase()]++; r.gf += m.gf; r.ga += m.ga;
      pairs.set(k, r);
    }
  }
  return [...pairs.values()]
    .filter((r) => r.n >= min)
    .map((r) => ({ ...r, winPct: r.w / r.n }))
    .sort((x, y) => y.winPct - x.winPct || y.n - x.n || (y.gf - y.ga) - (x.gf - x.ga));
}

export function headToHead(matches) {
  const by = new Map();
  for (const m of matches) {
    const k = m.opp.id ?? m.opp.name;
    const r = by.get(k) ?? { name: m.opp.name, n: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, last: 0 };
    r.n++; r[m.result.toLowerCase()]++; r.gf += m.gf; r.ga += m.ga; r.last = Math.max(r.last, m.ts);
    r.name = m.opp.name;
    by.set(k, r);
  }
  return [...by.values()].sort((a, b) => b.n - a.n || b.last - a.last);
}

/** Career change between two EA member snapshots (for week-over-week career deltas). */
export function careerDeltas(newer, older) {
  const old = new Map(older.map((m) => [m.name, m]));
  return newer
    .map((m) => {
      const o = old.get(m.name);
      if (!o) return null;
      return {
        name: m.name,
        games: (m.gamesPlayed ?? 0) - (o.gamesPlayed ?? 0),
        goals: (m.goals ?? 0) - (o.goals ?? 0),
        assists: (m.assists ?? 0) - (o.assists ?? 0),
        mom: (m.manOfTheMatch ?? 0) - (o.manOfTheMatch ?? 0),
        rating: (m.ratingAve ?? 0) - (o.ratingAve ?? 0),
      };
    })
    .filter((d) => d && d.games > 0);
}
