// Talks to EA's unofficial Pro Clubs endpoints.
// EA's edge is picky about HTTP clients, so we try a Chrome-impersonating
// client (impit) first and fall back to Node's built-in fetch.

const BASE = 'https://proclubs.ea.com/api/fc/';

const HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  referer: 'https://www.ea.com/',
  origin: 'https://www.ea.com',
};

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class EaError extends Error {
  constructor(message, { status, retryable, url } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
    this.url = url;
  }
}

let impitClient;
async function getImpit() {
  if (impitClient !== undefined) return impitClient;
  try {
    const { Impit } = await import('impit');
    impitClient = new Impit({ browser: 'chrome' });
  } catch {
    impitClient = null; // not installed / unsupported platform
  }
  return impitClient;
}

async function transports() {
  const list = [];
  const impit = await getImpit();
  if (impit) list.push({ name: 'impit', fetch: (u) => impit.fetch(u, { headers: HEADERS }) });
  list.push({
    name: 'fetch',
    fetch: (u) =>
      fetch(u, { headers: { ...HEADERS, 'user-agent': CHROME_UA }, signal: AbortSignal.timeout(20000) }),
  });
  return list;
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET an EA endpoint and return parsed JSON.
 * Retries on 403/429/5xx/network errors with backoff, rotating transports.
 */
export async function eaGet(path, params, { retries = 4, sleep = defaultSleep, transportList, log = () => {} } = {}) {
  const url = BASE + path + '?' + new URLSearchParams(params).toString();
  const list = transportList ?? (await transports());
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const t = list[attempt % list.length];
    try {
      const res = await t.fetch(url);
      if (res.ok) {
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          throw new EaError(`Non-JSON response from ${path}`, { status: res.status, retryable: true, url });
        }
      }
      const retryable = res.status === 403 || res.status === 429 || res.status >= 500;
      throw new EaError(`HTTP ${res.status} from ${path} via ${t.name}`, { status: res.status, retryable, url });
    } catch (err) {
      lastErr = err instanceof EaError ? err : new EaError(`${err.message} (${path} via ${t.name})`, { retryable: true, url });
      log(`attempt ${attempt + 1} failed: ${lastErr.message}`);
      if (!lastErr.retryable || attempt === retries) break;
      await sleep(Math.min(30000, 1500 * 2 ** attempt) + Math.floor(Math.random() * 1000));
    }
  }
  throw lastErr;
}

export const endpoints = {
  search: (platform, clubName, opts) => eaGet('allTimeLeaderboard/search', { platform, clubName }, opts),
  info: (platform, clubId, opts) => eaGet('clubs/info', { platform, clubIds: clubId }, opts),
  overall: (platform, clubId, opts) => eaGet('clubs/overallStats', { platform, clubIds: clubId }, opts),
  members: (platform, clubId, opts) => eaGet('members/stats', { platform, clubId }, opts),
  matches: (platform, clubId, matchType, opts) =>
    eaGet('clubs/matches', { platform, clubIds: clubId, matchType, maxResultCount: 10 }, opts),
};
