// Builds preview data from the real fixtures (data-preview/real) and a 3-week demo (data-preview/demo)
// so the dashboard can be checked before the real updater runs.
import { run } from './poll.mjs';
import { config, fakeFetchers, rawLeague, rawMembers } from './test/helpers.mjs';
import { readFile, writeFile, rm } from 'node:fs/promises';
const quiet = () => {};
await rm('data-preview', { recursive: true, force: true });
const now = Date.UTC(2026, 10, 14, 22, 0);
await run({ config, dataDir: 'data-preview/real', fetchers: fakeFetchers(), now, log: quiet });

// demo: spread the 10 matches over 3 weeks, and add an older career snapshot
const all = rawLeague();
const shift = (m, days) => ({ ...m, timestamp: m.timestamp - days * 86400 });
const week3 = all.slice(0, 4), week2 = all.slice(4, 7).map((m) => shift(m, 7)), week1 = all.slice(7).map((m) => shift(m, 14));
const older = rawMembers();
older.members = older.members.map((m) => ({ ...m, gamesPlayed: String(+m.gamesPlayed - 6), goals: String(Math.max(0, +m.goals - 3)), assists: String(Math.max(0, +m.assists - 2)) }));
await run({ config, dataDir: 'data-preview/demo', fetchers: { ...fakeFetchers({ league: week1 }), members: async () => older }, now: now - 9 * 864e5, log: quiet });
await run({ config, dataDir: 'data-preview/demo', fetchers: fakeFetchers({ league: [...week3, ...week2] }), now, log: quiet });
console.log('preview data ready');
