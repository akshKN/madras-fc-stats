// Rebuilds EA-shaped raw responses from the compact fixture so tests exercise real parsing.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');
export const CLUB = '830697';

const P_KEYS = ['playername', 'pos', 'archetypeid', 'goals', 'assists', 'shots', 'passesmade', 'passattempts',
  'tacklesmade', 'tackleattempts', 'rating', 'mom', 'redcards', 'saves', 'goalsconceded', 'cleansheetsdef',
  'cleansheetsgk', 'secondsPlayed', 'userResult'];

export function rawLeague() {
  const compact = JSON.parse(readFileSync(path.join(dir, 'league-compact.json'), 'utf8'));
  return compact.map(([id, ts, oppId, oppName, gf, ga, usDnf, themDnf, players]) => ({
    matchId: id,
    timestamp: ts,
    clubs: {
      [CLUB]: { goals: String(gf), goalsAgainst: String(ga), winnerByDnf: String(usDnf), details: { name: 'MADRAS  FC' } },
      [oppId]: { goals: String(ga), goalsAgainst: String(gf), winnerByDnf: String(themDnf), details: { name: oppName } },
    },
    players: {
      [CLUB]: Object.fromEntries(
        players.map((p, i) => [
          `9${i}${id.slice(-4)}`,
          { ...Object.fromEntries(P_KEYS.map((k, j) => [k, String(p[j])])), match_event_aggregate_0: '174:3,24:1' },
        ]),
      ),
      [oppId]: {},
    },
  }));
}

export const rawMembers = () => JSON.parse(readFileSync(path.join(dir, 'members.json'), 'utf8'));
export const rawOverall = () => JSON.parse(readFileSync(path.join(dir, 'overall.json'), 'utf8'));
export const rawSearch = () => [
  { clubId: CLUB, currentDivision: '8', clubInfo: { name: 'MADRAS  FC' } },
];

export const config = {
  clubId: CLUB,
  clubName: 'MADRAS  FC',
  platform: 'common-gen5',
  timeZone: 'America/Chicago',
  matchTypes: ['leagueMatch', 'playoffMatch'],
};

export function fakeFetchers({ league = rawLeague(), playoff = [], fail = {} } = {}) {
  const maybe = (name, v) => async () => {
    if (fail[name]) throw new Error(`${name} down`);
    return typeof v === 'function' ? v() : v;
  };
  return {
    matches: async (c, type) => {
      if (fail.matches) throw new Error('matches down');
      return type === 'leagueMatch' ? league : playoff;
    },
    members: maybe('members', rawMembers),
    overall: maybe('overall', rawOverall),
    search: maybe('search', rawSearch),
  };
}
