// Turns EA's raw responses into the compact format the website reads,
// and merges new matches into the saved history.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Convert one raw EA match into our stored shape, from our club's point of view. */
export function normalizeMatch(raw, clubId, type) {
  const us = String(clubId);
  const clubs = raw.clubs || {};
  const oppId = Object.keys(clubs).find((k) => k !== us) ?? null;
  const ours = clubs[us] || {};
  const theirs = (oppId && clubs[oppId]) || {};

  const gf = num(ours.goals);
  const ga = num(theirs.goals);
  let dnf = null;
  if (num(ours.winnerByDnf) === 1) dnf = 'them'; // opponent quit, we were awarded the win
  else if (num(theirs.winnerByDnf) === 1) dnf = 'us'; // we quit/disconnected

  let result;
  if (dnf === 'them') result = 'W';
  else if (dnf === 'us') result = 'L';
  else result = gf > ga ? 'W' : gf < ga ? 'L' : 'D';

  const players = Object.values((raw.players || {})[us] || {}).map((p) => ({
    name: p.playername,
    pos: p.pos,
    arch: num(p.archetypeid),
    g: num(p.goals),
    a: num(p.assists),
    sh: num(p.shots),
    pm: num(p.passesmade),
    pa: num(p.passattempts),
    tm: num(p.tacklesmade),
    ta: num(p.tackleattempts),
    rt: num(p.rating),
    mom: num(p.mom),
    rc: num(p.redcards),
    sv: num(p.saves),
    gc: num(p.goalsconceded),
    csd: num(p.cleansheetsdef),
    csg: num(p.cleansheetsgk),
    sec: num(p.secondsPlayed),
    ur: num(p.userResult),
  }));

  return {
    id: String(raw.matchId),
    ts: num(raw.timestamp),
    type,
    opp: { id: oppId, name: theirs.details?.name ?? 'Unknown' },
    gf,
    ga,
    result,
    dnf,
    players,
  };
}

/** Raw per-player event codes, kept separately so we can decode them later. */
export function extractEvents(raw, clubId) {
  const out = {};
  for (const p of Object.values((raw.players || {})[String(clubId)] || {})) {
    const ev = [0, 1, 2, 3].map((i) => p[`match_event_aggregate_${i}`] || '').filter(Boolean);
    if (ev.length) out[p.playername] = ev.join(',');
  }
  return out;
}

const keep = (obj, keys) => Object.fromEntries(keys.filter((k) => obj?.[k] != null).map((k) => [k, obj[k]]));

/**
 * Merge freshly fetched matches into saved history.
 * Returns { matches, added, gap } — gap is set when EA's 10-match window
 * no longer overlaps what we have saved (i.e. some matches were missed).
 */
export function mergeMatches(saved, fetched, type) {
  const byId = new Map(saved.map((m) => [m.id, m]));
  const savedOfType = saved.filter((m) => m.type === type);
  const newestSaved = savedOfType.reduce((mx, m) => Math.max(mx, m.ts), 0);

  let added = 0;
  for (const m of fetched) {
    const prev = byId.get(m.id);
    if (!prev) added++;
    // Opponent/our skill ratings are looked up separately (see poll.mjs) — don't lose them on a re-fetch.
    byId.set(m.id, prev ? { ...m, opp: { ...m.opp, ...keep(prev.opp, ['skill', 'skillTs']) }, ...keep(prev, ['ourSkill']) } : m);
  }

  let gap = null;
  if (savedOfType.length && fetched.length >= 10) {
    const overlaps = fetched.some((m) => savedOfType.some((s) => s.id === m.id));
    const oldestFetched = Math.min(...fetched.map((m) => m.ts));
    if (!overlaps && oldestFetched > newestSaved) gap = { type, from: newestSaved, to: oldestFetched };
  }

  const matches = [...byId.values()].sort((a, b) => b.ts - a.ts);
  return { matches, added, gap };
}

const MEMBER_FIELDS = [
  'gamesPlayed', 'winRate', 'goals', 'assists', 'shotSuccessRate', 'passesMade', 'passSuccessRate',
  'ratingAve', 'tacklesMade', 'tackleSuccessRate', 'manOfTheMatch', 'redCards', 'cleanSheetsDef',
  'cleanSheetsGK', 'proOverall', 'proName', 'favoritePosition',
];

export function normalizeMembers(raw) {
  return (raw?.members || []).map((m) => {
    const out = { name: m.name };
    for (const f of MEMBER_FIELDS) {
      if (m[f] === undefined) continue;
      out[f] = f === 'proName' || f === 'favoritePosition' ? m[f] : num(m[f]);
    }
    return out;
  });
}

/** Date (YYYY-MM-DD) in the club's home time zone. */
export function localDate(ms, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(ms),
  );
}
