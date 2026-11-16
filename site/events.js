// Decodes EA's hidden per-player event counters (match_event_aggregate_0..3).
// Mappings: community research (github.com/Interactive-63/eafc-pro-clubs-api-research),
// derived from ~51,000 FC 27 player-match rows. They are observations, not EA documentation.
//
// Every stat carries a source tier:
//   ea          — EA's own named field
//   decoded     — event code from the research, consistent with our own data
//   unverified  — decoded, but did NOT match an in-game screen we checked (shown, flagged)

export const FULL_MATCH_SECONDS = 5400;

/** "215:21,30:8" (possibly split across several buckets) → { 215: 21, 30: 8 } */
export function parseCodes(str) {
  const out = {};
  for (const part of String(str || '').split(',')) {
    const [k, v] = part.split(':');
    if (!k || v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = (out[k] || 0) + n;
  }
  return out;
}

// key → how to compute it from codes `e` (event counts) and `p` (EA named fields for the player-match)
const DEFS = {
  // passing
  passesCompleted:   { src: 'ea', f: (e, p) => p.pm },
  passesAttempted:   { src: 'ea', f: (e, p) => p.pa },
  fwdCompleted:      { src: 'decoded', f: (e) => e[30] || 0 },
  fwdFailed:         { src: 'decoded', f: (e) => e[31] || 0 },
  backCompleted:     { src: 'decoded', f: (e) => e[32] || 0 },
  sideCompleted:     { src: 'decoded', f: (e) => e[34] || 0 },
  shortCompleted:    { src: 'decoded', f: (e) => e[24] || 0 },
  mediumCompleted:   { src: 'decoded', f: (e) => e[26] || 0 },
  longCompleted:     { src: 'decoded', f: (e) => e[28] || 0 },
  longFailed:        { src: 'decoded', f: (e) => e[29] || 0 },
  crossesCompleted:  { src: 'decoded', f: (e) => e[36] || 0 },
  crossesFailed:     { src: 'decoded', f: (e) => e[37] || 0 },
  throughBalls:      { src: 'decoded', f: (e) => e[152] || 0 },
  switches:          { src: 'decoded', f: (e) => e[144] || 0 },
  firstTime:         { src: 'decoded', f: (e) => e[143] || 0 },
  secondAssists:     { src: 'decoded', f: (e) => e[115] || 0 },
  // attacking
  goals:             { src: 'ea', f: (e, p) => p.g },
  assists:           { src: 'ea', f: (e, p) => p.a },
  shots:             { src: 'ea', f: (e, p) => p.sh },
  shotsOnTarget:     { src: 'unverified', f: (e) => e[217] || 0 },
  shotsInBox:        { src: 'decoded', f: (e) => (e[13] || 0) + (e[14] || 0) },
  throughBallAssists:{ src: 'decoded', f: (e) => e[118] || 0 },
  mom:               { src: 'ea', f: (e, p) => p.mom },
  // dribbling + possession
  dribblesCompleted: { src: 'decoded', f: (e) => e[174] || 0 },
  beatNoSkill:       { src: 'decoded', f: (e) => Math.max(0, (e[112] || 0) - (e[38] || 0)) },
  beatSkill:         { src: 'decoded', f: (e) => e[38] || 0 },
  foulsWon:          { src: 'decoded', f: (e) => e[4] || 0 },
  possLostDef:       { src: 'unverified', f: (e) => e[105] || 0 },
  possLostMid:       { src: 'unverified', f: (e) => e[106] || 0 },
  possLostAtt:       { src: 'unverified', f: (e) => e[107] || 0 },
  possWonDef:        { src: 'unverified', f: (e) => e[108] || 0 },
  possWonMid:        { src: 'unverified', f: (e) => e[109] || 0 },
  possWonAtt:        { src: 'unverified', f: (e) => e[110] || 0 },
  // defending
  tacklesWon:        { src: 'ea', f: (e, p) => p.tm },
  tacklesAttempted:  { src: 'ea', f: (e, p) => p.ta },
  standingWon:       { src: 'decoded', f: (e) => e[229] || 0 },
  slidingWon:        { src: 'decoded', f: (e) => e[230] || 0 },
  interceptions:     { src: 'decoded', f: (e) => e[6] || 0 },
  dispossessed:      { src: 'decoded', f: (e) => e[158] || 0 },
  aerialsWon:        { src: 'decoded', f: (e) => (e[265] || 0) + (e[266] || 0) },
  foulsConceded:     { src: 'decoded', f: (e) => (e[2] || 0) + (e[3] || 0) },
  // positioning feedback
  inPosition:        { src: 'decoded', f: (e) => e[111] || 0 },
  outOfPosition:     { src: 'decoded', f: (e) => e[219] || 0 },
};

/**
 * Per-player totals of every advanced stat, over the given matches.
 * Only player-matches with game time and event data count. `events` is events.json.
 */
export function advancedTable(matches, events) {
  const by = new Map();
  for (const m of matches) {
    const ev = events?.[m.id] || {};
    for (const p of m.players) {
      if (!(p.sec > 0)) continue;
      const raw = ev[p.name];
      if (!raw) continue;
      const e = parseCodes(raw);
      let r = by.get(p.name);
      if (!r) {
        r = { name: p.name, apps: 0, sec: 0 };
        for (const k of Object.keys(DEFS)) r[k] = 0;
        by.set(p.name, r);
      }
      r.apps++;
      r.sec += p.sec;
      for (const [k, d] of Object.entries(DEFS)) r[k] += d.f(e, p) || 0;
    }
  }
  return [...by.values()].map(derive);
}

const ratio = (a, b) => (b > 0 ? a / b : null);

function derive(r) {
  const n90 = r.sec / FULL_MATCH_SECONDS;
  const p90 = (v) => (n90 > 0 ? v / n90 : null);
  const knownDir = r.fwdCompleted + r.backCompleted + r.sideCompleted;
  const possLost = r.possLostDef + r.possLostMid + r.possLostAtt;
  const possWon = r.possWonDef + r.possWonMid + r.possWonAtt;
  return {
    ...r,
    mins: Math.round(r.sec / 60),
    lowSample: r.apps < 5,
    // passing
    passPct: ratio(r.passesCompleted, r.passesAttempted),
    passesPer90: p90(r.passesCompleted),
    fwdShare: ratio(r.fwdCompleted, knownDir),
    backShare: ratio(r.backCompleted, knownDir),
    sideShare: ratio(r.sideCompleted, knownDir),
    fwdPct: ratio(r.fwdCompleted, r.fwdCompleted + r.fwdFailed),
    fwdPer90: p90(r.fwdCompleted),
    longPct: ratio(r.longCompleted, r.longCompleted + r.longFailed),
    throughPer90: p90(r.throughBalls),
    // attacking
    shotAcc: ratio(r.shotsOnTarget, r.shots),
    conversion: ratio(r.goals, r.shots),
    inBoxShare: ratio(r.shotsInBox, r.shots),
    gaPer90: p90(r.goals + r.assists),
    goalsPer90: p90(r.goals),
    shotsPer90: p90(r.shots),
    // dribbling + possession
    dribblesPer90: p90(r.dribblesCompleted),
    beatTotal: r.beatNoSkill + r.beatSkill,
    possLost,
    possWon,
    possLostPer90: p90(possLost),
    possWonPer90: p90(possWon),
    // defending
    tacklePct: ratio(r.tacklesWon, r.tacklesAttempted),
    interceptionsPer90: p90(r.interceptions),
    defActionsPer90: p90(r.tacklesWon + r.interceptions),
    inPositionPct: ratio(r.inPosition, r.inPosition + r.outOfPosition),
  };
}

/** Source tier for a stat key (derived stats inherit the weakest input). */
export const SOURCE = {
  ...Object.fromEntries(Object.entries(DEFS).map(([k, d]) => [k, d.src])),
  passPct: 'ea', passesPer90: 'ea', conversion: 'ea', gaPer90: 'ea', goalsPer90: 'ea', shotsPer90: 'ea', tacklePct: 'ea',
  fwdShare: 'decoded', backShare: 'decoded', sideShare: 'decoded', fwdPct: 'decoded', fwdPer90: 'decoded', longPct: 'decoded',
  throughPer90: 'decoded', inBoxShare: 'decoded', dribblesPer90: 'decoded', beatTotal: 'decoded',
  interceptionsPer90: 'decoded', defActionsPer90: 'decoded', inPositionPct: 'decoded',
  shotAcc: 'unverified', possLost: 'unverified', possWon: 'unverified', possLostPer90: 'unverified', possWonPer90: 'unverified',
};

export const SOURCE_INFO = {
  ea: { label: 'EA', text: 'EA’s own named stat, straight from the API.' },
  decoded: { label: 'Decoded', text: 'From EA’s hidden event codes, using community research mappings. Consistent with our own matches, but not labelled by EA.' },
  unverified: { label: 'Unverified', text: 'Decoded from hidden event codes, but it didn’t match the in-game Player Performance screen we checked. Treat as approximate until confirmed.' },
};

/** Plain-English explanations for tap-to-explain. */
export const EXPLAIN = {
  passPct: ['Pass accuracy', 'Completed passes ÷ attempted passes.'],
  passesPer90: ['Passes per 90', 'Completed passes scaled to a full 90-minute match, using actual minutes played.'],
  fwdShare: ['Forward share', 'Of completed passes with a known direction, the share played forward. Backward and sideways make up the rest.'],
  fwdPct: ['Forward pass accuracy', 'Completed forward passes ÷ attempted forward passes. Forward passes are harder, so this is usually lower than overall accuracy.'],
  fwdPer90: ['Forward passes per 90', 'Completed forward passes per full match. “Forward” means direction only — it is not the same as a line-breaking or progressive pass, which EA doesn’t record.'],
  longPct: ['Long pass accuracy', 'Completed long passes ÷ attempted long passes.'],
  throughBalls: ['Through balls', 'Successful through balls.'],
  throughPer90: ['Through balls per 90', 'Successful through balls per full match.'],
  switches: ['Switches of play', 'Passes that switch the play to the other side.'],
  firstTime: ['First-time passes', 'Passes played first time, without controlling the ball.'],
  secondAssists: ['Second assists', 'The pass before the assist.'],
  crossesCompleted: ['Crosses', 'Completed crosses, including set pieces.'],
  shotsOnTarget: ['Shots on target', 'Shots on target. Blocked shots can be counted here too, which may be why it didn’t match the in-game screen.'],
  shotAcc: ['Shot accuracy', 'Shots on target ÷ shots.'],
  conversion: ['Conversion', 'Goals ÷ shots. How clinical a player is.'],
  inBoxShare: ['Shots from the box', 'Share of shots taken from inside the penalty area.'],
  gaPer90: ['G+A per 90', 'Goals plus assists per full match.'],
  shotsPer90: ['Shots per 90', 'Shots per full match.'],
  throughBallAssists: ['Through-ball assists', 'Assists that came from a through ball.'],
  dribblesCompleted: ['Dribbles completed', 'Completed dribbles. Matched the in-game screen exactly (KRRN96 vs Warframe: 11).'],
  dribblesPer90: ['Dribbles per 90', 'Completed dribbles per full match.'],
  beatTotal: ['Players beaten', 'Opponents beaten on the ball, with or without a skill move.'],
  beatSkill: ['Beaten with skill moves', 'Opponents beaten using a skill move.'],
  foulsWon: ['Fouls won', 'Times this player was fouled.'],
  possLost: ['Possession lost', 'Times the ball was lost, split by pitch third (defensive / middle / attacking). Didn’t match the in-game screen we checked.'],
  possLostPer90: ['Possession lost per 90', 'Possession lost per full match. Lower is better.'],
  possWon: ['Possession won', 'Times the ball was won back, split by pitch third. Didn’t match the in-game screen we checked.'],
  possWonPer90: ['Possession won per 90', 'Possession won per full match.'],
  tacklePct: ['Tackle success', 'Tackles won ÷ tackles attempted.'],
  standingWon: ['Standing tackles won', 'Tackles won while staying on your feet.'],
  slidingWon: ['Sliding tackles won', 'Tackles won with a slide.'],
  interceptions: ['Interceptions', 'Passes intercepted.'],
  interceptionsPer90: ['Interceptions per 90', 'Interceptions per full match.'],
  dispossessed: ['Dispossessions', 'Times this player took the ball off an opponent.'],
  defActionsPer90: ['Ball-winning per 90', 'Tackles won plus interceptions, per full match.'],
  aerialsWon: ['Aerial duels won', 'Headers won, attacking and defending.'],
  foulsConceded: ['Fouls conceded', 'Fouls committed.'],
  inPositionPct: ['Positioning', 'Share of EA’s positioning feedback that was positive (“in position”) vs “out of position”.'],
};
