import * as S from './stats.js';
import { CLUBS, CLUB_ORDER, THEMES, tagFor, clubId } from './clubs.js';
import * as E from './events.js';
import * as A from './analytics.js';
import * as X from './experiments.js';

const cfg = window.MFC_CONFIG || {};
const TZ = cfg.timeZone || 'America/Chicago';
const qs = new URLSearchParams(location.search);
const BASE = (qs.get('data') || cfg.dataBase || '').replace(/\/?$/, '/');
const PLAYERS_URL = qs.get('players') || cfg.playersUrl || './players.json';
const EXP_URL = qs.get('experiments') || cfg.experimentsUrl || './experiments.json';
const REPO = cfg.repo || 'akshKN/madras-fc-stats';
const EXP_PATH = cfg.experimentsPath || 'experiments.json';
const DEMO = !!cfg.demoEditor; // offline preview: edits stay in memory
const NOW = Date.now();
const bust = Math.floor(NOW / 300000); // refresh at most every 5 minutes
const REDUCED = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const fx = (x, d = 1) => (x == null ? '–' : x.toFixed(d));
const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
const dtFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const weekLabel = (k) => `Week of ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(k + 'T00:00:00Z'))}`;
function ago(ms) {
  const m = Math.round((NOW - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return `${Math.round(h / 24)} days ago`;
}

// localStorage can be unavailable (private mode, some in-app browsers) — never let that break the page.
const store = {
  get(k) { try { return localStorage.getItem('mfc.' + k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem('mfc.' + k) : localStorage.setItem('mfc.' + k, v); } catch { /* ignore */ } },
};

async function getJSON(url, fallback) {
  try {
    const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}v=${bust}`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw e;
  }
}

const state = {
  week: null,
  mode: 'tracked', // squad table: tracked | career | defence
  period: 'all',
  sort: { key: 'rating', dir: -1 },
  cmp: { a: null, b: null, range: 10 },
  anView: 'team', // analytics: team | exp
  role: null, // analytics roles section
  me: store.get('me'),
  themeId: store.get('theme'),
  lastTab: null,
};
let D; // loaded data
let PICKS = {}; // gamertag → club id, from players.json

/* ---------------- clubs, badges, themes ---------------- */
const SHIELD = 'M20 2 L36 8 V22 C36 33 29 40 20 44 C11 40 4 33 4 22 V8 Z';
const SHIELD_HALF = 'M20 2 L36 8 V22 C36 33 29 40 20 44 Z';
const clubOf = (name) => PICKS[name] || null;

function badge(name, size = 40) {
  const c = CLUBS[clubOf(name) || 'madras'];
  const h = Math.round((size * 46) / 40);
  return `<svg class="badge" width="${size}" height="${h}" viewBox="0 0 40 46" role="img" aria-label="${esc(clubOf(name) ? c.label : 'No club picked')}"><path d="${SHIELD}" fill="${c.c1}" stroke="rgba(255,255,255,.35)" stroke-width="1"/><path d="${SHIELD_HALF}" fill="${c.c2}"/><text x="20" y="27" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-weight="800" font-size="12" fill="#fff" stroke="#000" stroke-width="2.4" paint-order="stroke">${esc(tagFor(name))}</text></svg>`;
}

// A tappable player name that opens their profile.
const plink = (name) => `<button type="button" class="pname js-player" data-player="${esc(name)}">${esc(name)}</button>`;

function activeThemeId() {
  if (state.themeId && THEMES[state.themeId]) return state.themeId;
  const mine = state.me && clubOf(state.me);
  return mine && THEMES[mine] ? mine : 'madras';
}
function applyTheme() {
  const th = THEMES[activeThemeId()];
  const r = document.documentElement.style;
  const map = { bg: '--bg', surface: '--surface', surface2: '--surface-2', border: '--border', text: '--text', muted: '--muted', accent: '--accent', onAccent: '--on-accent', accentText: '--accent-text', stripeA: '--stripe-a', stripeB: '--stripe-b', glow: '--glow' };
  for (const [k, v] of Object.entries(map)) r.setProperty(v, th[k]);
  r.setProperty('--grid', th.border);
  r.setProperty('--line', th.accentText);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', th.bg);
}

/* ---------------- tooltip ---------------- */
const tip = $('tip');
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x + 12));
  const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
const hideTip = () => { tip.hidden = true; };
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.chart')) hideTip(); });
window.addEventListener('scroll', hideTip, { passive: true });

/* ---------------- charts (hand-rolled SVG) ---------------- */
const tickStep = (range) => (range <= 6 ? 1 : range <= 12 ? 2 : range <= 30 ? 5 : 10);
function niceMax(v) {
  if (v <= 0) return 1;
  const st = tickStep(v);
  return Math.ceil(v / st) * st;
}
function ticks(min, max, step = tickStep(max - min)) {
  const out = [];
  for (let t = min; t <= max + 1e-9; t += step) out.push(+t.toFixed(6));
  return out;
}

/** Grouped bars (scored vs conceded per match). */
function barChart(matches) {
  const W = 380, H = 190, L = 22, R = 4, T = 10, B = 24;
  const iw = W - L - R, ih = H - T - B;
  const max = niceMax(Math.max(...matches.map((m) => Math.max(m.gf, m.ga)), 1));
  const y = (v) => T + ih - (v / max) * ih;
  const gw = iw / matches.length;
  const bw = Math.max(3, Math.min(14, (gw - 6) / 2));
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Goals scored and conceded in each of the last ${matches.length} matches">`;
  for (const t of ticks(0, max)) s += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
  const bar = (x, v, color) => {
    if (v <= 0) return `<rect x="${x}" y="${y(0) - 2}" width="${bw}" height="2" fill="${color}" opacity=".6"/>`;
    const top = y(v), h = y(0) - top, r = Math.min(4, bw / 2, h);
    // rounded top only, square at the baseline
    return `<path fill="${color}" d="M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${y(0)} Z"/>`;
  };
  matches.forEach((m, i) => {
    const cx = L + gw * i + gw / 2;
    s += bar(cx - bw - 1, m.gf, 'var(--scored)') + bar(cx + 1, m.ga, 'var(--conceded)');
    s += `<text x="${cx}" y="${H - 8}" text-anchor="middle" style="fill:${m.result === 'W' ? 'var(--good)' : m.result === 'L' ? '#f07a7a' : 'var(--warn)'};font-weight:700">${m.result}</text>`;
    const t = `<b>${esc(m.result)} ${m.gf}–${m.ga}</b> vs ${esc(m.opp.name)}<div class="row">${esc(dtFmt.format(m.ts * 1000))}</div><div class="row"><span class="swatch" style="background:var(--scored)"></span>Scored ${m.gf}</div><div class="row"><span class="swatch" style="background:var(--conceded)"></span>Conceded ${m.ga}</div>${m.dnf ? '<div class="row">Forfeit</div>' : ''}`;
    s += `<rect class="hit" x="${L + gw * i}" y="${T}" width="${gw}" height="${ih + B}" data-tip="${esc(t)}"/>`;
  });
  s += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="#55555c"/></svg>`;
  return s;
}

/** Line chart with crosshair. series: [{name,color,values}] over labels. */
function lineChart({ labels, series, fmt = (v) => fx(v), min = 0, max, step }) {
  const W = 380, H = 140, L = 34, R = 14, T = 8, B = 28;
  const iw = W - L - R, ih = H - T - B;
  const all = series.flatMap((s) => s.values).filter((v) => v != null);
  const hi = max ?? niceMax(Math.max(...all, min + 1));
  const x = (i) => L + (labels.length === 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
  const y = (v) => T + ih - ((v - min) / (hi - min)) * ih;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  for (const t of ticks(min, hi, step ?? tickStep(hi - min))) s += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`;
  const every = Math.ceil(labels.length / 5);
  labels.forEach((lb, i) => { if (i % every === 0 || i === labels.length - 1) s += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(lb)}</text>`; });
  for (const se of series) {
    const pts = se.values.map((v, i) => (v == null ? null : [x(i), y(v)]));
    const d = pts.reduce((acc, p, i) => (p ? acc + `${acc && pts[i - 1] ? 'L' : 'M'}${p[0]},${p[1]} ` : acc), '');
    s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    pts.forEach((p) => { if (p) s += `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${se.color}" stroke="var(--surface)" stroke-width="2"/>`; });
  }
  s += `<line class="xhair" y1="${T}" y2="${T + ih}" x1="-10" x2="-10" visibility="hidden"/>`;
  const tips = labels.map((lb, i) => `<b>${esc(lb)}</b>` + series.map((se) => `<div class="row"><span class="swatch" style="background:${se.color}"></span>${esc(se.name)}: ${se.values[i] == null ? '–' : fmt(se.values[i])}</div>`).join(''));
  s += `<rect class="hit" x="${L}" y="${T}" width="${iw}" height="${ih}" data-line='${esc(JSON.stringify({ n: labels.length, L, iw, tips }))}'/></svg>`;
  return s;
}

function wireCharts(root) {
  root.querySelectorAll('.hit[data-tip]').forEach((el) => {
    const on = (e) => { root.querySelectorAll('.hit.on').forEach((h) => h.classList.remove('on')); el.classList.add('on'); showTip(el.dataset.tip, e.clientX, e.clientY); };
    el.addEventListener('pointermove', on);
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { el.classList.remove('on'); hideTip(); } });
  });
  root.querySelectorAll('.hit[data-line]').forEach((el) => {
    const cfgL = JSON.parse(el.dataset.line);
    const svg = el.ownerSVGElement;
    const xh = svg.querySelector('.xhair');
    const on = (e) => {
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
      const i = cfgL.n === 1 ? 0 : Math.max(0, Math.min(cfgL.n - 1, Math.round(((loc.x - cfgL.L) / cfgL.iw) * (cfgL.n - 1))));
      const xx = cfgL.n === 1 ? cfgL.L + cfgL.iw / 2 : cfgL.L + (i / (cfgL.n - 1)) * cfgL.iw;
      xh.setAttribute('x1', xx); xh.setAttribute('x2', xx); xh.setAttribute('visibility', 'visible');
      showTip(cfgL.tips[i], e.clientX, e.clientY);
    };
    el.addEventListener('pointermove', on);
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { xh.setAttribute('visibility', 'hidden'); hideTip(); } });
  });
}


/* ---------------- rating sparkline ---------------- */
function sparkline(series, H0 = 70) {
  if (series.length < 2) return '<p class="empty" style="padding:8px 0">Not enough games yet for a trend.</p>';
  const W = 320, H = H0, L = 4, R = 4, T = 6, B = 6, iw = W - L - R, ih = H - T - B;
  const lo = 5, hi = 10;
  const x = (i) => L + (i / (series.length - 1)) * iw;
  const y = (v) => T + ih - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * ih;
  const pts = series.map((d, i) => [x(i), y(d.rating)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const avg = series.reduce((s, d) => s + d.rating, 0) / series.length;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rating over last ${series.length} games, average ${avg.toFixed(1)}">`;
  s += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y(avg)}" y2="${y(avg)}" style="stroke-dasharray:3 3"/>`;
  s += `<path d="${d}" fill="none" stroke="var(--line)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  pts.forEach((p, i) => { const c = series[i].rating >= 7.5 ? 'var(--good)' : series[i].rating < 6 ? '#f07a7a' : 'var(--line)'; s += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.2" fill="${c}" stroke="var(--surface)" stroke-width="1.5"/>`; });
  s += '</svg>';
  return s;
}


/* ---------------- small building blocks ---------------- */
const RESULT_WORD = { W: 'Win', D: 'Draw', L: 'Loss' };
const pill = (r, extra = '') => `<span class="pill ${r}" ${extra}>${r}</span>`;
const section = (title, sub = '') => `<div class="sec-head"><h2>${title}</h2>${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;
const countNum = (value, dec = 0, suffix = '') =>
  value == null ? '–' : `<span class="num" data-count="${value}" data-dec="${dec}" data-suffix="${esc(suffix)}">${Number(value).toFixed(dec)}${esc(suffix)}</span>`;

function deltaHTML(cur, prev, { fmt = (v) => v, better = 1, unit = '' } = {}) {
  if (cur == null || prev == null) return '';
  const d = cur - prev;
  if (Math.abs(d) < 1e-9) return '<div class="delta">same as last week</div>';
  const good = d * better > 0;
  return `<div class="delta"><span class="${better === 0 ? '' : good ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d))}${unit}</span> vs last week</div>`;
}

function footerHTML() {
  const st = D.status;
  const first = D.matches.length ? D.matches[D.matches.length - 1].ts * 1000 : null;
  return `<footer class="foot">
    ${st?.lastSuccess ? `<div>Updated ${esc(ago(st.lastSuccess))}${st.lastNewMatch ? ` · last new match found ${esc(ago(st.lastNewMatch))}` : ''}</div>` : ''}
    ${first ? `<div>Tracking league matches since ${esc(dateFmt.format(first))}.</div>` : ''}
    <div>Data from EA’s unofficial Pro Clubs endpoints. Not affiliated with or endorsed by EA.</div></footer>`;
}

/* ---------------- top bar + banner ---------------- */
function renderTopbar() {
  const c = D.club || {};
  const o = c.overall || {};
  const sub = [S.divisionLabel(c.currentDivision) || '', o.skillRating ? `Skill ${o.skillRating}` : ''].filter(Boolean).join(' · ');
  $('topbar').innerHTML = `<div class="brand"><div class="crest" aria-hidden="true">MFC</div>
    <div><div class="brand-name">${esc(cfg.clubName || c.name || 'Madras FC')}</div>${sub ? `<div class="brand-sub">${esc(sub)}</div>` : ''}</div></div>
    <button type="button" class="icon-btn press" id="open-theme" aria-label="Change club colours">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.5-1.1-.3-.3-.5-.7-.5-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.1-4-7.6-9-7.6z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10.5" cy="7.5" r="1.2"/><circle cx="15" cy="7.8" r="1.2"/></svg>
    </button>`;
}

function renderBanner() {
  const st = D.status;
  const out = [];
  if (st?.lastSuccess) {
    const hrs = (NOW - st.lastSuccess) / 3.6e6;
    if (hrs > (cfg.pollEveryHours || 2) * 4) out.push(`<div class="warn"><span>Stats haven't refreshed in ${Math.round(hrs)} hours — EA may be blocking the updater. Recent matches will appear once it recovers (as long as fewer than 10 are played in the meantime).</span></div>`);
  } else if (st && st.ok === false) {
    out.push(`<div class="warn"><span>The updater hasn't managed to reach EA yet.</span></div>`);
  }
  for (const g of (st?.gaps || []).filter((g) => NOW - g.detectedAt < 14 * 864e5)) {
    out.push(`<div class="info"><span>Some ${esc(g.type)} matches between ${esc(dateFmt.format(g.from * 1000))} and ${esc(dateFmt.format(g.to * 1000))} may be missing — EA only keeps the last 10.</span></div>`);
  }
  $('banner').className = out.length ? 'banner' : '';
  $('banner').innerHTML = out.join('');
}

/* ---------------- HOME ---------------- */
const AWARD_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>';

function viewHome() {
  const out = [];
  const m = D.matches[0];
  if (m) {
    const played = m.players.filter((p) => p.sec > 0).sort((a, b) => b.rt - a.rt);
    const scorers = m.players.filter((p) => p.g > 0).map((p) => `${plink(p.name)}${p.g > 1 ? ` ×${p.g}` : ''}`);
    out.push(`<article class="card hero rise">
      <div class="stripe" aria-hidden="true"></div>
      <div class="hero-body">
        <div class="hero-meta"><span class="eyebrow">Last match · ${esc(dtFmt.format(m.ts * 1000))}</span>${pill(m.result, `aria-label="${RESULT_WORD[m.result]}"`)}</div>
        <div class="scoreline">
          <span class="team">Madras FC</span>
          <span class="score num">${m.gf}–${m.ga}</span>
          <span class="team right">${esc(m.opp.name)}</span>
        </div>
        ${m.dnf ? `<div class="hero-note">${m.dnf === 'them' ? 'Opponent quit — awarded the win' : 'We quit — counted as a loss'}</div>` : ''}
        <div class="hero-foot">
          <span class="muted">Scored: <b>${scorers.length ? scorers.join(', ') : 'nobody'}</b></span>
          ${played[0] ? `<span class="muted">Top rated: ${plink(played[0].name)} <b class="accent">${played[0].rt.toFixed(1)}</b></span>` : ''}
        </div>
      </div></article>`);
    const last10 = D.matches.slice(0, 10).reverse();
    out.push(`<div class="rise" style="animation-delay:60ms"><div class="eyebrow" style="margin-bottom:8px">Form · last ${last10.length}, newest right</div>
      <div class="form">${last10.map((x) => pill(x.result, `title="${esc(`${x.result} ${x.gf}–${x.ga} vs ${x.opp.name}`)}"`)).join('')}</div></div>`);
  }

  const running = [...D.exps.list].filter((x) => !x.end).sort((a, b) => b.start.localeCompare(a.start))[0];
  if (running) {
    const r = X.evaluate(running, D.matches, TZ).during;
    out.push(`<button type="button" class="card pad xhome press rise" data-an="exp"><span class="eyebrow">Experiment running</span>
      <span class="row-between"><b>${esc(running.name)}</b><span class="chev" aria-hidden="true">›</span></span>
      <span class="k num">${r.n ? `${r.n} game${r.n === 1 ? '' : 's'} · ${r.w}W ${r.d}D ${r.l}L · ${pct(r.winPct)} wins` : `Since ${dayFmt(running.start)} · no games yet`}</span></button>`);
  }

  // This week
  const weeks = [...D.byWeek.keys()].sort().reverse();
  if (weeks.length) {
    if (!state.week || !D.byWeek.has(state.week)) state.week = weeks[0];
    const cur = S.summarize(D.byWeek.get(state.week));
    const prevKey = S.addDays(state.week, -7);
    const prev = D.byWeek.has(prevKey) ? S.summarize(D.byWeek.get(prevKey)) : null;
    const thisWk = S.weekKey(NOW / 1000, TZ);
    const opts = weeks.map((k) => `<option value="${k}" ${k === state.week ? 'selected' : ''}>${k === thisWk ? 'This week' : weekLabel(k)}</option>`).join('');
    out.push(`<section class="card pad rise" style="animation-delay:120ms" aria-labelledby="wk-h">
      <div class="card-head"><h2 id="wk-h">${state.week === thisWk ? 'This week' : esc(weekLabel(state.week))}</h2>
        <div class="tools"><button type="button" id="share-week" class="chip-btn press">Share</button>
        <label class="sr-wrap"><span class="sr-only">Week</span><select id="week-pick">${opts}</select></label></div></div>
      <div class="tiles">
        <div class="tile"><div class="label">Played</div><div class="big">${countNum(cur.n)}</div>${deltaHTML(cur.n, prev?.n, { better: 0 })}</div>
        <div class="tile"><div class="label">Record</div><div class="big num">${cur.w}-${cur.d}-${cur.l}</div><div class="delta">${prev ? `last week ${prev.w}-${prev.d}-${prev.l}` : 'won-drawn-lost'}</div></div>
        <div class="tile"><div class="label">Win rate</div><div class="big">${countNum(cur.winPct == null ? null : Math.round(cur.winPct * 100), 0, '%')}</div>${deltaHTML(cur.winPct, prev?.winPct, { fmt: (v) => Math.round(v * 100), unit: ' pts' })}</div>
        <div class="tile"><div class="label">Team rating</div><div class="big accent">${countNum(cur.rating, 2)}</div>${deltaHTML(cur.rating, prev?.rating, { fmt: (v) => v.toFixed(2) })}</div>
        <div class="tile wide"><div class="label">Goals for / against</div><div class="big">${countNum(cur.gf)}<span class="muted small-big"> / ${countNum(cur.ga)}</span></div><div class="delta">${fx(cur.gfPer)} scored and ${fx(cur.gaPer)} conceded per game</div></div>
      </div></section>`);

    // Awards
    const awards = S.weeklyAwards(D.byWeek.get(state.week), D.byWeek.get(prevKey) || []);
    if (awards.length) {
      out.push(`<section class="rise" style="animation-delay:180ms">${section('Awards', esc(weekLabel(state.week)))}
        <div class="rail">${awards.map((a) => `<div class="card award"><div class="accent">${AWARD_ICON}</div><div class="award-title">${esc(a.title)}</div>
          <div class="award-who">${a.names.map(plink).join(', ')}${a.names.length > 1 ? ' <span class="muted small">(shared)</span>' : ''}</div>
          <div class="muted small">${esc(a.value)}</div></div>`).join('')}</div></section>`);
    }
  }

  // Season
  const se = D.club?.season;
  if (se?.wins != null) {
    const total = se.wins + se.ties + se.losses || 1;
    out.push(`<section class="card pad rise" style="animation-delay:240ms"><div class="card-head"><h2>Season</h2><span class="muted small">${se.games} games${S.divisionLabel(D.club.currentDivision) ? ` · ${S.divisionLabel(D.club.currentDivision)}` : ''}</span></div>
      <div class="seasonbar" role="img" aria-label="${se.wins} won, ${se.ties} drawn, ${se.losses} lost">
        <i class="grow" style="width:${(se.wins / total) * 100}%;background:var(--good)"></i><i class="grow" style="width:${(se.ties / total) * 100}%;background:var(--warn);animation-delay:80ms"></i><i class="grow" style="width:${(se.losses / total) * 100}%;background:var(--bad);animation-delay:160ms"></i></div>
      <div class="legend-row"><span><b>${se.wins}</b> won</span><span><b>${se.ties}</b> drawn</span><span><b>${se.losses}</b> lost</span>${D.club.overall?.wins != null ? `<span class="muted">all-time ${D.club.overall.wins}-${D.club.overall.ties}-${D.club.overall.losses}</span>` : ''}</div></section>`);
  }

  // Career gains
  if (D.careerDelta?.length) {
    out.push(`<section class="card pad rise"><div class="card-head"><h2>Career gains</h2><span class="muted small">since ${esc(dateFmt.format(new Date(D.careerSince + 'T12:00:00Z')))} · EA totals</span></div>
      <ul class="list">${[...D.careerDelta].sort((a, b) => b.goals + b.assists - (a.goals + a.assists)).map((d) => `<li><span>${plink(d.name)} <span class="k">+${d.games} games</span></span><span class="v num">+${d.goals}G +${d.assists}A${d.mom ? ` · +${d.mom} MOTM` : ''}</span></li>`).join('')}</ul></section>`);
  }

  // Trends
  const weekly = S.weeklySeries(D.matches, TZ);
  if (weekly.length >= 2) {
    const labels = weekly.map((w) => dateFmt.format(new Date(w.week + 'T12:00:00Z')));
    out.push(`<section class="card pad rise chart-card"><div class="card-head"><h2>Week over week</h2><span class="muted small">${weekly.length} weeks</span></div>
      <div class="sm-title">Win rate</div>${lineChart({ labels, series: [{ name: 'Win rate', color: 'var(--line)', values: weekly.map((w) => w.winPct) }], fmt: (v) => `${Math.round(v * 100)}%`, min: 0, max: 1, step: 0.25 })}
      <div class="sm-title">Goals per game</div><div class="legend"><span><span class="swatch" style="background:var(--scored)"></span>For</span><span><span class="swatch" style="background:var(--conceded)"></span>Against</span></div>
      ${lineChart({ labels, series: [{ name: 'For', color: 'var(--scored)', values: weekly.map((w) => w.gfPer) }, { name: 'Against', color: 'var(--conceded)', values: weekly.map((w) => w.gaPer) }], fmt: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)) })}
      <div class="sm-title">Average team rating</div>${lineChart({ labels, series: [{ name: 'Team rating', color: 'var(--line)', values: weekly.map((w) => w.rating) }], fmt: (v) => v.toFixed(0), min: 5, max: 10, step: 1 })}
    </section>`);
  } else if (weekly.length === 1) {
    out.push(`<section class="card pad rise"><div class="card-head"><h2>Week over week</h2></div><p class="empty">Trend charts appear once you’ve played in two different weeks.</p></section>`);
  }

  if (!D.matches.length) out.push('<section class="card pad"><p class="empty">No matches tracked yet — they’ll appear after your next league game.</p></section>');
  return out.join('') + footerHTML();
}

/* ---------------- MATCHES ---------------- */
function viewMatches() {
  const recent = D.matches.slice(0, 15).reverse();
  const r = S.records(D.matches);
  const mline = (m) => `${m.gf}–${m.ga} vs ${esc(m.opp.name)}`;
  const rec = [];
  if (r.bigWin) rec.push(['Biggest win', mline(r.bigWin), dateFmt.format(r.bigWin.ts * 1000)]);
  if (r.bigLoss) rec.push(['Heaviest loss', mline(r.bigLoss), dateFmt.format(r.bigLoss.ts * 1000)]);
  if (r.bestRating) rec.push(['Best match rating', `${plink(r.bestRating.name)} · ${r.bestRating.rt.toFixed(1)}`, `vs ${esc(r.bestRating.m.opp.name)}`]);
  if (r.mostScored) rec.push(['Most goals in a match', `${plink(r.mostScored.name)} · ${r.mostScored.g}`, `vs ${esc(r.mostScored.m.opp.name)}`]);
  rec.push(['Longest win streak', `${r.winStreak.best}`, `current: ${r.winStreak.current}`]);
  rec.push(['Longest unbeaten run', `${r.unbeaten.best}`, `current: ${r.unbeaten.current}`]);
  const h2h = S.headToHead(D.matches).slice(0, 8);

  return `<div class="page-title rise"><h1>Matches</h1><p class="muted">${D.matches.length} league matches tracked</p></div>
    <section class="card pad rise chart-card" style="animation-delay:60ms"><div class="card-head"><h2>Recent matches</h2><span class="muted small">goals per game</span></div>
      <div class="legend"><span><span class="swatch" style="background:var(--scored)"></span>Scored</span><span><span class="swatch" style="background:var(--conceded)"></span>Conceded</span><span class="muted">Tap a match</span></div>
      ${recent.length ? barChart(recent) : '<p class="empty">No matches yet.</p>'}</section>
    <section class="card pad rise" style="animation-delay:120ms"><div class="card-head"><h2>Match log</h2><button type="button" id="share-week" class="chip-btn press">Share week</button></div>
      ${D.matches.slice(0, 60).map(matchRow).join('') || '<p class="empty">No matches tracked yet.</p>'}</section>
    <section class="card pad rise" style="animation-delay:180ms"><div class="card-head"><h2>Records</h2></div>
      <ul class="list">${rec.map(([k, v, sub]) => `<li><span><span class="k">${k}</span><br>${v}</span><span class="v k">${sub}</span></li>`).join('')}</ul>
      <p class="note">Forfeits don’t count toward scoreline records.</p></section>
    <section class="card pad rise" style="animation-delay:240ms"><div class="card-head"><h2>Opponents</h2></div>
      ${h2h.length ? `<ul class="list">${h2h.map((o) => `<li><span><b>${esc(o.name)}</b><br><span class="k">${o.n} meeting${o.n > 1 ? 's' : ''} · last ${esc(dateFmt.format(o.last * 1000))}</span></span><span class="v num">${o.w}W ${o.d}D ${o.l}L<br><span class="k">${o.gf}–${o.ga}</span></span></li>`).join('')}</ul>` : '<p class="empty">No opponents yet.</p>'}</section>
    ${footerHTML()}`;
}

function matchRow(m) {
  const tr = S.teamRating(m);
  const ps = [...m.players].sort((a, b) => (b.sec > 0) - (a.sec > 0) || b.rt - a.rt);
  return `<details class="match"><summary>${pill(m.result, `aria-label="${RESULT_WORD[m.result]}"`)}
    <span class="score num">${m.gf}–${m.ga}</span>
    <span class="mid"><span class="opp">${esc(m.opp.name)}</span><span class="when">${esc(dtFmt.format(m.ts * 1000))}${m.dnf ? `<span class="tag">${m.dnf === 'them' ? 'they quit' : 'we quit'}</span>` : ''}${m.type !== 'league' ? `<span class="tag">${esc(m.type)}</span>` : ''}</span></span>
    <span class="tr num">${tr ? tr.toFixed(1) : '–'}<span class="when">rating</span></span></summary>
    <div class="detail"><div class="table-wrap"><table><thead><tr><th>Player</th><th>Rating</th><th>G</th><th>A</th><th>Shots</th><th>Passes</th><th>Tackles</th><th>Mins</th></tr></thead><tbody>
    ${ps.map((p) => p.sec > 0
      ? `<tr><td>${plink(p.name)}${p.mom ? ' <span class="star" title="Man of the match">★</span>' : ''}<span class="pos">${esc((p.pos || '').slice(0, 3).toUpperCase())}</span></td><td class="num">${p.rt.toFixed(1)}</td><td class="num">${p.g}</td><td class="num">${p.a}</td><td class="num">${p.sh}</td><td class="num">${p.pm}/${p.pa}</td><td class="num">${p.tm}/${p.ta}</td><td class="num">${Math.round(p.sec / 60)}</td></tr>`
      : `<tr class="dnp"><td>${plink(p.name)}</td><td colspan="7" style="text-align:left">didn’t get on the pitch</td></tr>`).join('')}
    </tbody></table></div></div></details>`;
}

/* ---------------- SQUAD ---------------- */
// Stats table views. fmt: pct | f1 | f2 | int.  Source tier comes from events.js SOURCE (EA when absent).
const VIEWS = {
  tracked: { label: 'Overview', sort: 'rating', cols: [['apps', 'Apps'], ['g', 'G'], ['a', 'A'], ['gaPerGame', 'G+A/gm', 'f2'], ['rating', 'Rating', 'f2'], ['passPct', 'Pass %', 'pct'], ['tacklePct', 'Tackle %', 'pct'], ['sh', 'Shots'], ['mom', 'MOTM'], ['winPct', 'Win %', 'pct']] },
  passing: { label: 'Passing', sort: 'fwdPer90', adv: true, cols: [['apps', 'Apps'], ['passesPer90', 'Cmp/90', 'f1'], ['passPct', 'Pass %', 'pct'], ['fwdShare', 'Fwd share', 'pct'], ['fwdPct', 'Fwd acc', 'pct'], ['fwdPer90', 'Fwd/90', 'f1'], ['throughBalls', 'Through balls'], ['throughPer90', 'TB/90', 'f1'], ['longPct', 'Long acc', 'pct'], ['switches', 'Switches'], ['secondAssists', '2nd ast']] },
  attack: { label: 'Attack', sort: 'gaPer90', adv: true, cols: [['apps', 'Apps'], ['goals', 'G'], ['assists', 'A'], ['gaPer90', 'G+A/90', 'f2'], ['shots', 'Shots'], ['shotsPer90', 'Shots/90', 'f1'], ['conversion', 'Conversion', 'pct'], ['shotsOnTarget', 'On target'], ['shotAcc', 'Shot acc', 'pct'], ['inBoxShare', 'In box', 'pct'], ['throughBallAssists', 'TB ast']] },
  possession: { label: 'Possession', sort: 'dribblesPer90', adv: true, cols: [['apps', 'Apps'], ['dribblesCompleted', 'Dribbles'], ['dribblesPer90', 'Drib/90', 'f1'], ['beatTotal', 'Beaten'], ['beatSkill', 'Skill beat'], ['foulsWon', 'Fouls won'], ['possLostPer90', 'Lost/90', 'f1'], ['possLostDef', 'Lost D'], ['possLostMid', 'Lost M'], ['possLostAtt', 'Lost A'], ['possWonPer90', 'Won/90', 'f1']] },
  defence: { label: 'Defence', sort: 'defActionsPer90', adv: true, cols: [['apps', 'Apps'], ['tacklesWon', 'Tackles won'], ['tacklePct', 'Tackle %', 'pct'], ['standingWon', 'Standing'], ['slidingWon', 'Sliding'], ['interceptions', 'Interceptions'], ['interceptionsPer90', 'Int/90', 'f1'], ['dispossessed', 'Dispossess'], ['defActionsPer90', 'Won ball/90', 'f1'], ['concededPer90', 'Conceded/90', 'f2'], ['cs', 'Clean sheets'], ['inPositionPct', 'Positioning', 'pct']] },
  career: { label: 'Career', sort: 'ratingAve', cols: [['gamesPlayed', 'GP'], ['goals', 'G'], ['assists', 'A'], ['ratingAve', 'Rating', 'f1'], ['passSuccessRate', 'Pass %', 'rawpct'], ['tackleSuccessRate', 'Tackle %', 'rawpct'], ['shotSuccessRate', 'Shot %', 'rawpct'], ['manOfTheMatch', 'MOTM'], ['winRate', 'Win %', 'rawpct'], ['proOverall', 'OVR']] },
};
const srcOf = (view, key) => (VIEWS[view].adv ? E.SOURCE[key] || 'ea' : 'ea');
const srcMark = (tier) => (tier === 'decoded' ? '<sup class="src-mark d" aria-label="decoded">D</sup>' : tier === 'unverified' ? '<sup class="src-mark u" aria-label="unverified">?</sup>' : '');
const srcTag = (tier) => (tier === 'ea' || !tier ? '' : `<span class="src-tag ${tier}">${E.SOURCE_INFO[tier]?.label || 'EA'}</span>`);

function fmtVal(v, fmt) {
  if (v == null || Number.isNaN(v)) return '–';
  if (fmt === 'pct') return pct(v);
  if (fmt === 'rawpct') return `${v}%`;
  if (fmt === 'f1') return fx(v, 1);
  if (fmt === 'f2') return fx(v, 2);
  return v;
}
function nameCell(r) {
  const pos = r.mainPos || r.favoritePosition;
  return `${plink(r.name)}${pos ? `<span class="pos">${esc(pos.slice(0, 3).toUpperCase())}</span>` : ''}`;
}

/** Rows for a table view: EA tracked stats merged with decoded event stats. */
function tableRows(view, matches) {
  if (view === 'career') return D.members;
  const tracked = S.playerTable(matches);
  if (!VIEWS[view].adv) return tracked;
  const adv = new Map(E.advancedTable(matches, D.events).map((r) => [r.name, r]));
  return tracked.map((t) => ({ ...adv.get(t.name), ...t }));
}

function viewSquad() {
  const tracked = S.playerTable(D.matches);
  const byName = new Map(tracked.map((r) => [r.name, r]));
  const roster = (D.members.length ? D.members : tracked.map((t) => ({ name: t.name })))
    .map((m) => ({ m, t: byName.get(m.name) }))
    .sort((a, b) => (b.t?.rating ?? 0) - (a.t?.rating ?? 0) || a.m.name.localeCompare(b.m.name));

  const rows = roster.map(({ m, t }, i) => {
    const club = clubOf(m.name);
    return `<li class="card squad-row rise" style="animation-delay:${i * 40}ms">
      <button type="button" class="row-btn press js-player" data-player="${esc(m.name)}">
        ${badge(m.name, 40)}
        <span class="row-main"><span class="row-name">${esc(m.name)}${m.name === state.me ? ' <span class="you">You</span>' : ''}</span>
          <span class="row-sub">${esc((t?.mainPos || m.favoritePosition || '').slice(0, 3).toUpperCase() || '—')}${m.proOverall ? ` · OVR ${m.proOverall}` : ''}${club ? ` · ${esc(CLUBS[club].label)}` : ''}</span></span>
        <span class="row-stat"><span class="accent num">${t?.rating != null ? t.rating.toFixed(2) : '—'}</span><span class="row-sub">${t ? `${t.apps} apps · ${t.g}G ${t.a}A` : 'not in tracked games'}</span></span>
      </button></li>`;
  }).join('');

  // stats table
  const view = VIEWS[state.mode] ? state.mode : 'tracked';
  const V = VIEWS[view];
  const cols = [['name', 'Player'], ...V.cols];
  const src = tableRows(view, view !== 'career' && state.period === 'week' && state.week ? D.byWeek.get(state.week) || [] : D.matches);
  const { key, dir } = state.sort;
  const validKey = cols.some(([k]) => k === key) ? key : V.sort;
  const small = (r) => (view !== 'career' && r.apps < 5 ? 1 : 0);
  const sorted = [...src].sort((a, b) => {
    if (small(a) !== small(b)) return small(a) - small(b); // under-5-game rows always sink below the rest
    const va = a[validKey], vb = b[validKey];
    if (typeof va === 'string' || typeof vb === 'string') return dir * String(va ?? '').localeCompare(String(vb ?? ''), undefined, { sensitivity: 'base' });
    return dir * ((va ?? -Infinity) - (vb ?? -Infinity));
  });
  const th = cols.map(([k, label]) => `<th scope="col" ${k === validKey ? `aria-sort="${dir < 0 ? 'descending' : 'ascending'}"` : ''}><button type="button" data-sort="${k}">${label}${srcMark(srcOf(view, k))}${k === validKey ? (dir < 0 ? ' ↓' : ' ↑') : ''}</button></th>`).join('');
  const body = sorted.map((r) => `<tr class="${small(r) ? 'faint' : ''}${r.name === state.me ? ' me' : ''}">${cols.map(([k, , f]) => `<td class="num">${k === 'name' ? nameCell(r) : fmtVal(r[k], f)}</td>`).join('')}</tr>`).join('');
  const seg = (attr, val, label, cur) => `<button type="button" class="seg press" data-${attr}="${val}" aria-pressed="${cur === val}">${label}</button>`;
  const hasDecoded = V.cols.some(([k]) => srcOf(view, k) !== 'ea');
  const notes = {
    tracked: 'Tracked league matches only, counting appearances with game time.',
    career: 'Career totals come straight from EA and include matches from before tracking started.',
  };
  const duos = S.partnerships(D.matches, 3).slice(0, 6);
  const adv = E.advancedTable(D.matches, D.events).filter((x) => !x.lowSample);
  const lead = (label, key, f) => {
    const c = adv.filter((x) => x[key] != null).sort((a, b) => b[key] - a[key])[0];
    return c ? `<button type="button" class="lead press js-player" data-player="${esc(c.name)}"><span class="lead-k">${label}</span><b class="lead-n">${esc(c.name)}</b><span class="lead-v num accent">${fmtVal(c[key], f)}</span></button>` : '';
  };
  const leaders = adv.length >= 3 ? `<section class="rise"><div class="card-head"><h2>Squad leaders</h2><span class="muted small">5+ tracked games</span></div><div class="leads">${[
    lead('Pass accuracy', 'passPct', 'pct'), lead('Through balls /90', 'throughPer90', 'f1'), lead('Dribbles /90', 'dribblesPer90', 'f1'),
    lead('Conversion', 'conversion', 'pct'), lead('Interceptions /90', 'interceptionsPer90', 'f1'), lead('G+A /90', 'gaPer90', 'f2'),
  ].join('')}</div></section>` : '';

  return `<div class="page-title rise"><h1>Squad</h1><p class="muted">Tap a player for their profile. Badges show each player’s club.</p></div>
    ${leaders}
    <ul class="squad">${rows}</ul>
    <section class="card pad rise"><div class="card-head"><h2>Stats table</h2><button type="button" class="link-accent small" data-explain-view="${view}">What these mean</button></div>
      <div class="segs scroll">${Object.entries(VIEWS).map(([k, v]) => seg('mode', k, v.label, view)).join('')}</div>
      ${view !== 'career' ? `<div class="segs">${seg('period', 'all', 'All tracked', state.period)}${seg('period', 'week', 'This week', state.period)}</div>` : ''}
      ${sorted.length ? `<div class="tw"><div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div></div>` : '<p class="empty">No data for this view yet.</p>'}
      <p class="note">${notes[view] || 'Tracked league matches. “/90” = per full match, from actual minutes played.'}${view !== 'career' ? ' Faded rows: fewer than 5 games, listed last.' : ''}</p>
      ${hasDecoded ? '<p class="note"><sup class="src-mark d">D</sup> decoded from EA’s hidden event codes · <sup class="src-mark u">?</sup> unverified, didn’t match the in-game screen · no mark = EA’s own stat</p>' : ''}
    </section>
    <section class="card pad rise"><div class="card-head"><h2>Best duos</h2><span class="muted small">3+ games together</span></div>
      ${duos.length ? `<ul class="list">${duos.map((d) => `<li class="block"><div class="row-between"><span>${plink(d.a)} + ${plink(d.b)}</span><span class="v num">${pct(d.winPct)}</span></div><div class="k num">${d.n} games · ${d.w}W ${d.d}D ${d.l}L · ${d.gf}–${d.ga}</div><div class="bar" aria-hidden="true"><i class="grow" style="width:${Math.round(d.winPct * 100)}%"></i></div></li>`).join('')}</ul>` : '<p class="empty">Needs a few more games together.</p>'}</section>
    <p class="note center">Want a badge? Tell AkshKN your club — or edit <b>players.json</b> in the GitHub repo.</p>
    ${footerHTML()}`;
}


/* ---------------- analytics tab ---------------- */
function viewAnalytics() {
  const tracked = S.playerTable(D.matches).sort((x, y) => y.apps - x.apps);
  const names = tracked.map((t) => t.name);
  const c = state.cmp;
  if (!names.includes(c.a)) c.a = names.includes(state.me) ? state.me : names[0];
  if (!names.includes(c.b) || c.b === c.a) c.b = names.find((n) => n !== c.a) || c.a;
  const cmp = A.compare(D.matches, D.events, c.a, c.b, c.range);
  const opt = (sel) => names.map((n) => `<option value="${esc(n)}"${n === sel ? ' selected' : ''}>${esc(n)}</option>`).join('');
  const seg = (val, label) => `<button type="button" class="seg press" data-range="${val}" aria-pressed="${String(c.range) === String(val)}">${label}</button>`;
  const rows = cmp.rows.map((r) => `<tr><td class="num cv ${r.edge === 'a' ? 'edge' : ''}">${fmtVal(r.a, r.fmt)}</td><td class="cl">${esc(r.label)}</td><td class="num cv ${r.edge === 'b' ? 'edge' : ''}">${fmtVal(r.b, r.fmt)}</td></tr>`).join('');
  const thin = [[c.a, cmp.appsA], [c.b, cmp.appsB]].filter(([, n]) => n < 5);
  const warn = thin.length ? `<p class="note warnnote">${thin.map(([n, k]) => `${esc(n)}: ${k} game${k === 1 ? '' : 's'}`).join(' · ')} in this window — small samples swing a lot.</p>` : '';
  const hc = A.byHeadcount(D.matches);
  const hcRows = hc.map((r) => `<li class="block"><div class="row-between"><span><b>${r.humans}</b> of us</span><span class="v num">${pct(r.winPct)} wins</span></div><div class="k num">${r.n} game${r.n === 1 ? '' : 's'} · ${r.w}W ${r.d}D ${r.l}L · ${r.gf}–${r.ga} (${r.gdPerGame >= 0 ? '+' : ''}${fx(r.gdPerGame, 1)}/game)</div><div class="bar" aria-hidden="true"><i class="grow" style="width:${Math.round((r.winPct || 0) * 100)}%"></i></div></li>`).join('');
  const os = A.byOpponentStrength(D.matches);
  const osRow = (label, r) => (r.n ? `<li class="block"><div class="row-between"><span>${label}</span><span class="v num">${pct(r.winPct)} wins</span></div><div class="k num">${r.n} game${r.n === 1 ? '' : 's'} · ${r.w}W ${r.d}D ${r.l}L · ${r.gf}–${r.ga} (${r.gdPerGame >= 0 ? '+' : ''}${fx(r.gdPerGame, 1)}/game)</div><div class="bar" aria-hidden="true"><i class="grow" style="width:${Math.round((r.winPct || 0) * 100)}%"></i></div></li>` : '');
  const oppHTML = os.rated ? `<section class="card pad rise"><div class="card-head"><h2>By opponent strength</h2><span class="muted small">${os.rated} rated game${os.rated === 1 ? '' : 's'}</span></div>
      <ul class="list">${osRow('Rated <b>above</b> us', os.stronger)}${osRow('Rated <b>below</b> us', os.weaker)}</ul>
      <p class="note">Uses EA’s skill rating for both clubs, looked up shortly after each match.${os.unknown ? ` ${os.unknown} older game${os.unknown === 1 ? '' : 's'} have no rating.` : ''}${os.rated < 10 ? ' Small sample so far.' : ''}</p></section>` : '';
  const tr = A.trios(D.matches, 4).slice(0, 6);
  const trRows = tr.map((t) => `<li class="block"><div class="row-between"><span>${t.names.map(plink).join(' · ')}</span><span class="v num">${pct(t.winPct)}</span></div><div class="k num">${t.n} games · ${t.w}W ${t.d}D ${t.l}L · ${t.gf}–${t.ga}</div></li>`).join('');
  const anSeg = (v, label) => `<button type="button" class="seg press" data-an="${v}" aria-pressed="${state.anView === v}">${label}</button>`;
  const head = `<div class="page-title rise"><h1>Analytics</h1><p class="muted">Compare players and see what works for the squad.</p></div>
    <div class="segs">${anSeg('team', 'Players & team')}${anSeg('exp', 'Experiments')}</div>`;
  if (state.anView === 'exp') return `${head}${experimentsHTML()}${footerHTML()}`;
  return `${head}
    <section class="card pad rise"><div class="card-head"><h2>Compare</h2><span class="muted small">${cmp.games} club games</span></div>
      <div class="cmp-pick"><select id="cmp-a" aria-label="Player one">${opt(c.a)}</select><span class="muted">vs</span><select id="cmp-b" aria-label="Player two">${opt(c.b)}</select></div>
      <div class="segs">${seg(5, 'Last 5')}${seg(10, 'Last 10')}${seg('all', 'All tracked')}</div>
      <table class="cmp"><tbody>${rows}</tbody></table>
      ${warn}<p class="note">Highlighted = better. Per-90 stats use actual minutes. Through balls, dribbles, interceptions and conversion are decoded from EA’s hidden event codes.</p></section>
    ${rolesSectionHTML()}
    <section class="card pad rise"><div class="card-head"><h2>Results by squad size</h2><span class="muted small">how many of us played</span></div>
      ${hcRows ? `<ul class="list">${hcRows}</ul>` : '<p class="empty">No data yet.</p>'}</section>
    ${oppHTML}
    <section class="card pad rise"><div class="card-head"><h2>Best trios</h2><span class="muted small">4+ games together</span></div>
      ${trRows ? `<ul class="list">${trRows}</ul>` : '<p class="empty">Needs a few more games together.</p>'}</section>
    ${footerHTML()}`;
}

/* ---------------- experiments ---------------- */
const isEditor = () => DEMO || !!store.get('gh');
const ghOpts = () => ({ token: store.get('gh'), repo: REPO, path: EXP_PATH, branch: 'main' });
async function saveExps(mutate, message) {
  if (DEMO) { D.exps = { list: mutate(D.exps.list).map(X.clean), error: null }; return; }
  D.exps = { list: await X.saveExperiments(ghOpts(), mutate, message), error: null };
}
const dayFmt = (iso) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));
const today = () => X.localDate(NOW / 1000, TZ);
const signed = (v, d, mult = 1, suffix = '') => (v == null ? '' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v * mult).toFixed(d)}${suffix}`);
const expById = (id) => D.exps.list.find((x) => x.id === id);

function expCard(x) {
  const r = X.evaluate(x, D.matches, TZ);
  const d = r.during, dl = r.delta;
  const cell = (label, val, delta) => `<div class="xcell"><span class="k">${label}</span><b class="num">${val}</b>${delta ? `<span class="xd num">${delta}</span>` : ''}</div>`;
  const grid = d.n ? `<div class="xgrid">
      ${cell('Record', `${d.w}–${d.d}–${d.l}`)}
      ${cell('Win rate', pct(d.winPct), signed(dl.winPct, 0, 100, ' pts'))}
      ${cell('Scored /game', fx(d.gfPer, 1), signed(dl.gfPer, 1))}
      ${cell('Conceded /game', fx(d.gaPer, 1), signed(dl.gaPer, 1))}
      ${cell('Team rating', fx(d.rating, 2), signed(dl.rating, 2))}
      ${cell('Clean sheets', d.cleanSheets)}
    </div>
    <p class="note">${r.baseline.n ? `Small numbers show the change from the ${r.baseline.n} game${r.baseline.n === 1 ? '' : 's'} before it started.` : 'No earlier tracked games to compare against.'}${r.lowSample ? ' Fewer than 5 games so far — too early to judge.' : ''}</p>`
    : `<p class="empty">No league games ${r.active ? 'since it started yet' : 'were played in this window'}.</p>`;
  const edit = isEditor() ? `<div class="xacts">${r.active ? `<button type="button" class="chip-btn press" data-x="end" data-id="${esc(x.id)}">End experiment</button>` : ''}<button type="button" class="link-muted" data-x="edit" data-id="${esc(x.id)}">Edit</button><button type="button" class="link-muted" data-x="del" data-id="${esc(x.id)}">Delete</button></div>` : '';
  return `<li class="card pad xcard rise">
    <div class="row-between"><h3>${esc(x.name)}</h3>${x.formation ? `<span class="fchip num">${esc(x.formation)}</span>` : ''}</div>
    <div class="k">${r.active ? `Running since ${dayFmt(x.start)}` : `${dayFmt(x.start)} – ${dayFmt(x.end)}`} · ${d.n} game${d.n === 1 ? '' : 's'}</div>
    ${x.change ? `<p class="xnote">${esc(x.change)}</p>` : ''}
    ${grid}
    ${x.expect ? `<p class="k">Expected: ${esc(x.expect)}</p>` : ''}
    ${!r.active && (x.outcome || x.verdict) ? `<p class="xverdict"><b>${esc(X.OUTCOMES[x.outcome] || 'Ended')}</b>${x.verdict ? ` — ${esc(x.verdict)}` : ''}</p>` : ''}
    ${edit}</li>`;
}

function experimentsHTML() {
  const list = [...D.exps.list].sort((a, b) => b.start.localeCompare(a.start));
  const active = list.filter((x) => !x.end), done = list.filter((x) => x.end);
  const ed = isEditor();
  return `${D.exps.error ? `<p class="note warnnote">${esc(D.exps.error)}</p>` : ''}
    ${ed ? '<button type="button" class="primary press" data-x="add" style="margin:0 0 14px">+ New experiment</button>' : ''}
    <div class="card-head"><h2>Running now</h2></div>
    ${active.length ? `<ul class="xcards">${active.map(expCard).join('')}</ul>` : `<p class="empty">Nothing running. ${ed ? 'Start one above.' : ''}</p>`}
    ${done.length ? `<div class="card-head" style="margin-top:18px"><h2>Finished</h2></div><ul class="xcards">${done.map(expCard).join('')}</ul>` : ''}
    <p class="note center">${DEMO ? 'Preview: changes here are not saved anywhere.' : ed ? 'You can edit on this phone. <button type="button" class="link-muted" data-x="signout">Remove access</button>' : '<button type="button" class="link-muted" data-x="setup">Editor setup</button>'}</p>`;
}

const field = (id, label, value, attrs = '') => `<label class="fld"><span>${label}</span><input id="${id}" value="${esc(value)}" ${attrs}></label>`;
function expFormSheet(id) {
  const x = (id && expById(id)) || { name: '', start: today(), formation: '', change: '', expect: '', end: '', outcome: '', verdict: '' };
  return `<div class="sheet-head"><h2>${id ? 'Edit experiment' : 'New experiment'}</h2><button type="button" class="chip-btn press" data-close>Cancel</button></div>
    <div class="sheet-body">
      ${field('x-name', 'Name', x.name, 'maxlength="60" placeholder="e.g. Switch to 3-5-2" autocomplete="off"')}
      ${field('x-start', 'Start date', x.start, 'type="date"')}
      <div class="fld"><span>Formation <small>(optional)</small></span>
        <div class="segs">${X.FORMATIONS.map((f) => `<button type="button" class="seg press" data-fm="${f}" aria-pressed="${f === x.formation}">${f}</button>`).join('')}</div>
        <input id="x-formation" value="${esc(x.formation)}" maxlength="20" placeholder="or type your own" aria-label="Formation" autocomplete="off"></div>
      ${field('x-change', 'What are you changing? <small>(optional)</small>', x.change, 'maxlength="240" placeholder="e.g. KRRN96 as lone striker" autocomplete="off"')}
      ${field('x-expect', 'What do you expect? <small>(optional)</small>', x.expect, 'maxlength="240" placeholder="e.g. concede less" autocomplete="off"')}
      ${x.end ? `${field('x-end', 'End date', x.end, 'type="date"')}${field('x-verdict', 'Verdict', x.verdict, 'maxlength="240" autocomplete="off"')}` : ''}
      <button type="button" class="primary press" data-x="save" data-id="${esc(id || '')}">${id ? 'Save changes' : 'Start experiment'}</button>
      <p class="k center" id="x-msg" aria-live="polite"></p></div>`;
}
function expEndSheet(id) {
  const x = expById(id);
  return `<div class="sheet-head"><h2>End experiment</h2><button type="button" class="chip-btn press" data-close>Cancel</button></div>
    <div class="sheet-body"><p class="muted small" style="margin-top:0">${esc(x.name)}</p>
      <div class="fld"><span>How did it go?</span><div class="segs">${Object.entries(X.OUTCOMES).map(([k, v]) => `<button type="button" class="seg press" data-oc="${k}" aria-pressed="false">${v}</button>`).join('')}</div></div>
      ${field('x-end', 'End date', today() < x.start ? x.start : today(), 'type="date"')}
      ${field('x-verdict', 'One-line verdict <small>(optional)</small>', '', 'maxlength="240" placeholder="e.g. Conceded less, keeping it" autocomplete="off"')}
      <button type="button" class="primary press" data-x="saveend" data-id="${esc(id)}">End experiment</button>
      <p class="k center" id="x-msg" aria-live="polite"></p></div>`;
}
function expDeleteSheet(id) {
  return `<div class="sheet-head"><h2>Delete?</h2><button type="button" class="chip-btn press" data-close>Cancel</button></div>
    <div class="sheet-body"><p style="margin-top:0">Delete “${esc(expById(id).name)}”? This can’t be undone from the site.</p>
      <button type="button" class="primary danger press" data-x="confirmdel" data-id="${esc(id)}">Delete experiment</button>
      <p class="k center" id="x-msg" aria-live="polite"></p></div>`;
}
function setupSheet() {
  const u = X.tokenUrls();
  return `<div class="sheet-head"><h2>Editor setup</h2><button type="button" class="chip-btn press" data-close>Close</button></div>
    <div class="sheet-body"><p class="muted small" style="margin-top:0">One-time, about 3 minutes. Only for people who log experiments — everyone else can just read them.</p>
      <ol class="steps">
        <li><a class="link-accent" href="${u.owner}" target="_blank" rel="noopener">Open GitHub’s token page</a> and sign in. The name, expiry (1 year) and permission are filled in for you.</li>
        <li>Under <b>Repository access</b> choose <b>Only select repositories</b> and pick <b>madras-fc-stats</b>.</li>
        <li>Tap <b>Generate token</b>, copy it, and paste it here.</li>
      </ol>
      <label class="fld"><span>Access token</span><input id="x-token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_…"></label>
      <button type="button" class="primary press" data-x="savetoken">Save on this phone</button>
      <p class="k center" id="x-msg" aria-live="polite"></p>
      <p class="note">The token stays on this phone only and is sent only to GitHub. Never share it in a chat. Not the repo owner? Ask AkshKN to add you as a collaborator, then <a class="link-muted" href="${u.collaborator}" target="_blank" rel="noopener">create this kind of token instead</a>.</p></div>`;
}
async function expAction(btn) {
  const act = btn.dataset.x, id = btn.dataset.id;
  if (act === 'add') return openSheet(expFormSheet(null));
  if (act === 'edit') return openSheet(expFormSheet(id));
  if (act === 'end') return openSheet(expEndSheet(id));
  if (act === 'del') return openSheet(expDeleteSheet(id));
  if (act === 'setup') return openSheet(setupSheet());
  if (act === 'signout') { store.set('gh', null); return render(); }
  const msg = $('x-msg'), val = (k) => $(k)?.value ?? '';
  const busy = (on, text) => { btn.disabled = on; if (msg) msg.textContent = text; };
  try {
    if (act === 'savetoken') {
      const token = val('x-token').trim();
      busy(true, 'Checking with GitHub…');
      await X.checkToken({ token, repo: REPO });
      store.set('gh', token);
      try { const cur = await X.loadExperiments(ghOpts()); D.exps = { list: cur.list, error: cur.error }; } catch { /* keep what we have */ }
    } else if (act === 'save') {
      const old = id ? expById(id) : {};
      const entry = X.clean({ ...old, id: id || X.newId(), name: val('x-name'), start: val('x-start'), formation: val('x-formation'), change: val('x-change'), expect: val('x-expect'), ...(old.end ? { end: val('x-end'), verdict: val('x-verdict') } : {}) });
      busy(true, 'Saving…');
      await saveExps((l) => X.upsert(l, entry), `${id ? 'Update' : 'Start'} experiment: ${entry.name}`);
    } else if (act === 'saveend') {
      const entry = X.clean({ ...expById(id), end: val('x-end'), verdict: val('x-verdict'), outcome: modal.querySelector('[data-oc][aria-pressed="true"]')?.dataset.oc || '' });
      busy(true, 'Saving…');
      await saveExps((l) => X.upsert(l, entry), `End experiment: ${entry.name}`);
    } else if (act === 'confirmdel') {
      busy(true, 'Deleting…');
      await saveExps((l) => X.remove(l, id), 'Delete experiment');
    } else return;
    closeSheet(); render();
  } catch (e) { busy(false, e.message || 'Something went wrong. Try again.'); }
}

/* ---------------- roles ---------------- */
function rolesHTML(name) {
  const rows = A.playerRoles(D.matches, D.events, name);
  if (!rows.length) return '';
  const block = (r) => {
    const R = A.ROLES[r.role];
    return `<div class="rblock"><div class="row-between"><b>As a ${R.label.toLowerCase()}</b><span class="k num">${r.apps} game${r.apps === 1 ? '' : 's'} · ${r.w}W ${r.d}D ${r.l}L</span></div>
      <div class="xgrid">${R.metrics.map(([k, label, f]) => `<div class="xcell"><span class="k">${label}</span><b class="num">${fmtVal(r[k], f)}</b></div>`).join('')}</div>
      ${r.small ? '<p class="note warnnote">Fewer than 5 games in this role — treat as a rough guide.</p>' : ''}</div>`;
  };
  return `<section class="card pad rise"><div class="card-head"><h2>By role</h2><span class="muted small">where EA says they lined up</span></div>
    ${rows.map(block).join('')}
    <p class="note">EA reports the line (forward, midfielder, defender, keeper) for each match, not the exact position.</p></section>`;
}
function rolesSectionHTML() {
  const roles = A.rolesPlayed(D.matches);
  if (!roles.length) return '';
  if (!roles.includes(state.role)) state.role = roles[0];
  const R = A.ROLES[state.role];
  const rows = A.roleTable(D.matches, D.events, state.role);
  const th = `<th scope="col">Player</th><th scope="col" class="num">Games</th>${R.metrics.map(([, label]) => `<th scope="col" class="num">${label}</th>`).join('')}`;
  const body = rows.map((r) => `<tr class="${r.small ? 'faint' : ''}${r.name === state.me ? ' me' : ''}"><td>${plink(r.name)}</td><td class="num">${r.apps}</td>${R.metrics.map(([k, , f]) => `<td class="num">${fmtVal(r[k], f)}</td>`).join('')}</tr>`).join('');
  return `<section class="card pad rise"><div class="card-head"><h2>Roles</h2><span class="muted small">ranked by rating</span></div>
    ${roles.length > 1 ? `<div class="segs">${roles.map((k) => `<button type="button" class="seg press" data-role="${k}" aria-pressed="${k === state.role}">${A.ROLES[k].plural}</button>`).join('')}</div>` : ''}
    <div class="tw"><div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div></div>
    <p class="note">Counts only the games each player spent as a ${R.label.toLowerCase()}. Faded rows: fewer than 5 games in the role, listed last.${roles.length < 3 ? ' Nobody has played the other lines in tracked games yet.' : ''}</p></section>`;
}

/* ---------------- advanced stats (profile) ---------------- */
function advancedHTML(name) {
  const r = E.advancedTable(D.matches, D.events).find((x) => x.name === name);
  if (!r) return '';
  const pool = E.advancedTable(D.matches, D.events).filter((x) => !x.lowSample);
  const rk = (key, fn) => {
    if (r.lowSample || pool.length < 3) return '';
    const val = fn ? fn(r) : r[key];
    if (val == null) return '';
    const n = 1 + pool.filter((x) => (fn ? fn(x) : x[key]) > val).length;
    return ` <small class="rank">#${n} of ${pool.length}</small>`;
  };
  const p90 = (v) => (v == null ? '' : ` <small>${fx(v, 1)}/90</small>`);
  const row = (key, value, extra = '', rank = '') => `<li><button type="button" class="xlabel" data-explain="${key}">${esc(E.EXPLAIN[key]?.[0] || key)}</button><span class="xv num">${value}${extra}${rank}</span>${srcTag(E.SOURCE[key] || 'ea')}</li>`;
  const known = r.fwdCompleted + r.backCompleted + r.sideCompleted;
  const dirBar = known
    ? `<div class="dirbar" role="img" aria-label="Pass direction: ${pct(r.fwdShare)} forward, ${pct(r.sideShare)} sideways, ${pct(r.backShare)} backward">
        <i class="f" style="width:${(r.fwdShare || 0) * 100}%"></i><i class="s" style="width:${(r.sideShare || 0) * 100}%"></i><i class="b" style="width:${(r.backShare || 0) * 100}%"></i></div>
       <div class="dirlegend num"><span>${pct(r.fwdShare)} forward</span><span>${pct(r.sideShare)} sideways</span><span>${pct(r.backShare)} back</span></div>`
    : '';
  const group = (title, items) => `<div class="xgroup"><h3>${title}</h3><ul class="xlist">${items.join('')}</ul></div>`;
  return `<details class="card adv rise">
    <summary><span><b>Advanced stats</b><span class="muted small"> · ${r.apps} tracked game${r.apps === 1 ? '' : 's'}, ${r.mins} min</span></span><span class="chev" aria-hidden="true">›</span></summary>
    <div class="adv-body">
      ${r.lowSample ? '<p class="note warnnote">Fewer than 5 tracked games — these numbers will swing a lot.</p>' : ''}
      ${group('Passing', [
        row('passPct', `${pct(r.passPct)} <small>${r.passesCompleted}/${r.passesAttempted}</small>`, '', rk('passPct')),
        `<li class="xwide"><button type="button" class="xlabel" data-explain="fwdShare">Pass direction</button>${srcTag('decoded')}${dirBar}</li>`,
        row('fwdPct', pct(r.fwdPct), p90(r.fwdPer90), rk('fwdPct')),
        row('throughBalls', r.throughBalls, p90(r.throughPer90), rk('throughBalls')),
        row('switches', r.switches),
        row('firstTime', r.firstTime),
        row('longPct', pct(r.longPct)),
        row('secondAssists', r.secondAssists),
        row('crossesCompleted', r.crossesCompleted),
      ])}
      ${group('Attacking', [
        row('conversion', pct(r.conversion), ` <small>${r.goals}/${r.shots}</small>`, rk('conversion')),
        row('gaPer90', fx(r.gaPer90, 2)),
        row('shotsOnTarget', r.shotsOnTarget, ` <small>${pct(r.shotAcc)} acc</small>`),
        row('inBoxShare', pct(r.inBoxShare)),
        row('throughBallAssists', r.throughBallAssists),
      ])}
      ${group('Dribbling & possession', [
        row('dribblesCompleted', r.dribblesCompleted, p90(r.dribblesPer90), rk('dribblesCompleted')),
        row('beatTotal', r.beatTotal, ` <small>${r.beatSkill} with skills</small>`),
        row('foulsWon', r.foulsWon),
        row('possLost', r.possLost, ` <small>D ${r.possLostDef} · M ${r.possLostMid} · A ${r.possLostAtt}</small>`),
        row('possWon', r.possWon, ` <small>D ${r.possWonDef} · M ${r.possWonMid} · A ${r.possWonAtt}</small>`),
      ])}
      ${group('Defending', [
        row('tacklePct', pct(r.tacklePct), ` <small>${r.tacklesWon}/${r.tacklesAttempted}</small>`),
        row('standingWon', r.standingWon, ` <small>${r.slidingWon} sliding</small>`),
        row('interceptions', r.interceptions, p90(r.interceptionsPer90)),
        row('dispossessed', r.dispossessed),
        row('aerialsWon', r.aerialsWon),
        row('foulsConceded', r.foulsConceded),
        row('inPositionPct', pct(r.inPositionPct)),
      ])}
      <p class="note">Tap any stat to see what it measures. <b>Decoded</b> stats come from EA’s hidden event codes (community-mapped); <b>Unverified</b> ones didn’t match the in-game screen we checked. EA doesn’t record xG, progressive passes or pressure.</p>
    </div></details>`;
}

const EA_EXPLAIN = {
  apps: ['Apps', 'Tracked league games where the player got game time.'],
  g: ['Goals', 'Goals in tracked league games.'], goals: ['Goals', 'Goals.'],
  a: ['Assists', 'Assists in tracked league games.'], assists: ['Assists', 'Assists.'],
  sh: ['Shots', 'Shots in tracked league games.'], shots: ['Shots', 'Shots.'],
  gaPerGame: ['G+A per game', 'Goals plus assists per appearance.'],
  rating: ['Rating', 'Average EA match rating in tracked games.'],
  mom: ['MOTM', 'Man of the Match awards.'], winPct: ['Win %', 'Share of the player’s tracked games that were won.'],
  tacklesWon: ['Tackles won', 'Tackles won.'], concededPer90: ['Conceded per 90', 'Goals the team let in while this player was on the pitch, per full match.'],
  cs: ['Clean sheets', 'Tracked games with no goals conceded while the player played.'],
  gamesPlayed: ['Games', 'All-time games for the club, per EA.'], ratingAve: ['Rating', 'All-time average rating, per EA.'],
  passSuccessRate: ['Pass %', 'All-time pass accuracy, per EA.'], tackleSuccessRate: ['Tackle %', 'All-time tackle success, per EA.'],
  shotSuccessRate: ['Shot %', 'All-time shot accuracy, per EA.'], manOfTheMatch: ['MOTM', 'All-time Man of the Match awards.'],
  winRate: ['Win %', 'All-time win rate, per EA.'], proOverall: ['OVR', 'The player’s Pro overall rating.'],
};

function explainSheet(keys, title) {
  const items = keys.filter((k) => E.EXPLAIN[k] || EA_EXPLAIN[k]).map((k) => {
    const [label, text] = E.EXPLAIN[k] || EA_EXPLAIN[k];
    const tier = E.SOURCE[k] || 'ea';
    return `<li class="block"><div class="row-between"><b>${esc(label)}</b>${srcTag(tier)}</div><div class="k" style="margin-top:4px">${esc(text)}</div></li>`;
  });
  return `<div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="chip-btn press" data-close>Done</button></div>
    <div class="sheet-body"><ul class="list">${items.join('')}</ul>
      <p class="note">${Object.values(E.SOURCE_INFO).map((s) => `<b>${s.label}:</b> ${esc(s.text)}`).join('<br>')}</p></div>`;
}

/* ---------------- PROFILE ---------------- */
function viewWhoami() {
  const names = (D.members.length ? D.members.map((m) => m.name) : S.playerTable(D.matches).map((r) => r.name)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return `<div class="page-title rise"><h1>Who are you?</h1><p class="muted">Pick your player once. This phone remembers it, so the Profile tab opens straight to you. No login needed.</p></div>
    <ul class="squad">${names.map((n, i) => `<li class="card squad-row rise" style="animation-delay:${i * 40}ms">
      <button type="button" class="row-btn press" data-me="${esc(n)}">${badge(n, 36)}
        <span class="row-main"><span class="row-name">${esc(n)}</span></span><span class="accent small"><b>That’s me</b></span></button></li>`).join('')}</ul>`;
}

function viewProfile(name) {
  const pr = S.playerProfile(D.matches, D.members, name);
  if (!pr.tracked && !pr.career) {
    return `<div class="page-title"><h1>${esc(name)}</h1><p class="muted">No stats found for this player.</p></div><a class="chip-btn" href="#squad">Back to squad</a>`;
  }
  const club = clubOf(name);
  const c = CLUBS[club || 'madras'];
  const t = pr.tracked, k = pr.career;
  const isMe = state.me === name;
  const cellm = (label, val) => `<div class="cellm"><div class="l">${label}</div><div class="v num">${val}</div></div>`;
  const series = pr.ratingSeries;
  const avg = series.length ? series.reduce((s, d) => s + d.rating, 0) / series.length : null;
  const today = dateFmt.format(NOW);

  // The card always wears the player's own club colours, whoever is viewing it.
  const pt = THEMES[club || 'madras'];
  const cardVars = `--surface:${pt.surface};--surface-2:${pt.surface2};--border:${pt.border};--text:${pt.text};--muted:${pt.muted};--accent:${pt.accent};--on-accent:${pt.onAccent};--accent-text:${pt.accentText};--line:${pt.accentText};background:${pt.surface};color:${pt.text};border-color:${pt.border}`;
  const card = `<article class="card pcard rise" style="${cardVars}" aria-label="${esc(name)} player card">
    <div class="pstripe" style="background:repeating-linear-gradient(115deg, ${c.c1} 0 14px, ${c.c2} 14px 28px)" aria-hidden="true"></div>
    <div class="pcard-head">${badge(name, 46)}
      <div class="min0 grow1"><div class="profile-name">${esc(name)}${isMe ? ' <span class="you">You</span>' : ''}</div>
        <div class="muted small">${esc(pr.favoritePosition || '')}${club ? ` · ${esc(c.label)} fan` : ''}</div></div>
      ${k?.proOverall ? `<div class="ovr"><b class="num">${k.proOverall}</b><span>OVR</span></div>` : ''}
    </div>
    ${t ? `<div class="pcard-sec"><div class="mini-h"><span>Tracked league</span><span>${t.apps} app${t.apps === 1 ? '' : 's'}</span></div>
      <div class="mini-grid">${cellm('Rating', fx(t.rating, 2))}${cellm('Goals', t.g)}${cellm('Assists', t.a)}${cellm('MOTM', t.mom)}
      ${cellm('Pass', pct(t.passPct))}${cellm('Tackle', pct(t.tacklePct))}${cellm('Shots', t.sh)}${cellm('Win', pct(t.winPct))}</div></div>` : ''}
    ${series.length >= 2 ? `<div class="pcard-sec"><div class="mini-h"><span>Match rating</span><span>last ${series.length} · avg ${avg.toFixed(2)}</span></div>${sparkline(series, 40)}</div>` : ''}
    ${k ? `<div class="pcard-sec"><div class="mini-h"><span>Career · EA totals</span><span>${k.gamesPlayed} games</span></div>
      <div class="mini-grid">${cellm('Rating', fx(k.ratingAve, 1))}${cellm('Goals', k.goals)}${cellm('Assists', k.assists)}${cellm('MOTM', k.manOfTheMatch)}
      ${cellm('Pass', k.passSuccessRate != null ? k.passSuccessRate + '%' : '–')}${cellm('Tackle', k.tackleSuccessRate != null ? k.tackleSuccessRate + '%' : '–')}${cellm('Shot', k.shotSuccessRate != null ? k.shotSuccessRate + '%' : '–')}${cellm('Win', k.winRate != null ? k.winRate + '%' : '–')}</div></div>` : ''}
    ${pr.milestones.length ? `<div class="pcard-sec"><div class="mini-h"><span>Next milestones</span></div><div class="ms-grid">${pr.milestones.map((m) => `<div class="ms"><div class="row-between"><span class="cap">${m.label}</span><span class="num"><b>${m.value}</b><span class="muted">/${m.target}</span></span></div><div class="bar thin"><i class="grow" style="width:${Math.max(2, Math.round((m.value / m.target) * 100))}%"></i></div></div>`).join('')}</div></div>` : ''}
    <div class="pcard-foot"><span>Madras FC · EA FC 27 Pro Clubs</span><span>${esc(today)}</span></div>
  </article>`;

  const extras = [];
  if (pr.best.length) extras.push(`<section class="card pad rise"><div class="card-head"><h2>Best games</h2></div><ul class="list">${pr.best.map((b) => `<li><span><b class="num">${b.rating.toFixed(1)}</b> <span class="k">vs ${esc(b.opp)} (${b.gf}–${b.ga})</span></span><span class="v k">${b.g}G ${b.a}A${b.mom ? ' ★' : ''} · ${esc(dateFmt.format(b.ts * 1000))}</span></li>`).join('')}</ul></section>`);
  if (pr.partners.length) extras.push(`<section class="card pad rise"><div class="card-head"><h2>Plays best with</h2></div><ul class="list">${pr.partners.map((p) => `<li><span>${plink(p.name)}</span><span class="v num">${pct(p.winPct)} <span class="k">${p.n} gm</span></span></li>`).join('')}</ul></section>`);

  return `<div class="profile-nav">
      <a class="link-muted" href="#squad">‹ Squad</a>
      ${isMe ? '<button type="button" class="link-muted" id="switch-me">Not you? Switch</button>' : state.me ? '<a class="link-accent" href="#profile">My profile ›</a>' : ''}
    </div>
    ${card}
    ${rolesHTML(name)}
    ${advancedHTML(name)}
    ${extras.join('')}
    ${footerHTML()}`;
}

/* ---------------- sheets (theme picker, weekly recap) ---------------- */
const modal = $('modal');
function openSheet(html) {
  modal.innerHTML = `<div class="backdrop" data-close></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  modal.hidden = false;
  document.body.classList.add('locked');
  modal.querySelector('.sheet button, .sheet textarea')?.focus({ preventScroll: true });
}
function closeSheet() {
  if (modal.hidden) return;
  modal.hidden = true;
  modal.innerHTML = '';
  document.body.classList.remove('locked');
}

function themeSheetHTML() {
  const cur = activeThemeId();
  const mine = state.me && clubOf(state.me);
  return `<div class="sheet-head"><h2>Your colours</h2><button type="button" class="chip-btn press" data-close>Done</button></div>
    <div class="sheet-body"><p class="muted small" style="margin-top:0">Theme the app in your club’s colours. Saved on this phone only.</p>
      <div class="choices">${CLUB_ORDER.map((id) => `<button type="button" class="choice press" data-theme="${id}" aria-pressed="${id === cur}">
        <span class="dot" aria-hidden="true"><i style="background:${CLUBS[id].c1}"></i><i style="background:${CLUBS[id].c2}"></i></span>${esc(CLUBS[id].label)}</button>`).join('')}</div>
      ${mine ? `<button type="button" class="link-accent" data-theme="auto" style="margin-top:12px">Match my badge (${esc(CLUBS[mine].label)})</button>` : ''}
    </div>`;
}

function recapHTML() {
  const weeks = [...D.byWeek.keys()].sort().reverse();
  const wk = state.week && D.byWeek.has(state.week) ? state.week : weeks[0];
  if (!wk) return `<div class="sheet-head"><h2>Share</h2><button type="button" class="chip-btn" data-close>Done</button></div><div class="sheet-body"><p class="empty">No matches yet.</p></div>`;
  const label = wk === S.weekKey(NOW / 1000, TZ) ? 'This week' : weekLabel(wk);
  const text = S.weeklyRecap(D.byWeek.get(wk) || [], { clubName: cfg.clubName || 'Madras FC', weekLabel: label, prevMatches: D.byWeek.get(S.addDays(wk, -7)) || [] });
  return `<div class="sheet-head"><h2>Share ${esc(label.toLowerCase())}</h2><button type="button" class="chip-btn press" data-close>Done</button></div>
    <div class="sheet-body"><p class="muted small" style="margin-top:0">Copy this into your group chat.</p>
      <textarea id="recap-text" readonly rows="${Math.min(14, text.split('\n').length + 1)}">${esc(text)}</textarea>
      <button type="button" class="primary press" id="recap-copy">Copy text</button>
      <p class="k center" id="recap-done" aria-live="polite"></p></div>`;
}

async function copyRecap() {
  const ta = $('recap-text');
  try {
    await navigator.clipboard.writeText(ta.value);
    $('recap-done').textContent = 'Copied ✓';
  } catch {
    ta.focus(); ta.select();
    $('recap-done').textContent = document.execCommand?.('copy') ? 'Copied ✓' : 'Select the text above and copy it manually.';
  }
}

/* ---------------- router + render ---------------- */
// The URL hash is the route on the real site. Inside embedded previews the hash can be unreliable,
// so in-app navigation also keeps the route in memory and never depends on a hashchange event.
let memRoute = null;
function route() {
  const h = memRoute ?? decodeURIComponent(location.hash.replace(/^#/, ''));
  if (h.startsWith('p=')) return { tab: 'profile', who: h.slice(2) };
  if (['matches', 'squad', 'analytics', 'profile'].includes(h)) return { tab: h };
  return { tab: 'home' };
}

function countUp(root) {
  const els = root.querySelectorAll('[data-count]');
  if (REDUCED || !els.length) return;
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / 900);
    const e = 1 - Math.pow(1 - p, 3);
    els.forEach((el) => { el.textContent = (Number(el.dataset.count) * e).toFixed(Number(el.dataset.dec)) + el.dataset.suffix; });
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function render() {
  if (!D) return;
  applyTheme();
  renderTopbar();
  const r = route();
  const view = $('view');
  if (r.tab === 'home') view.innerHTML = viewHome();
  else if (r.tab === 'matches') view.innerHTML = viewMatches();
  else if (r.tab === 'squad') view.innerHTML = viewSquad();
  else if (r.tab === 'analytics') view.innerHTML = viewAnalytics();
  else if (r.who) view.innerHTML = viewProfile(r.who);
  else view.innerHTML = state.me ? viewProfile(state.me) : viewWhoami();
  document.querySelectorAll('.tab').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === r.tab ? 'page' : 'false'));
  const key = r.tab + (r.who || '');
  if (state.lastTab !== null && state.lastTab !== key) window.scrollTo({ top: 0 });
  state.lastTab = key;
  wireCharts(view);
  countUp(view);
}

const go = (hash) => {
  memRoute = decodeURIComponent(hash);
  try { if (location.protocol !== 'about:' && location.hash !== '#' + hash) location.hash = hash; } catch { /* ignore */ }
  render();
};

document.addEventListener('click', (e) => {
  // Never match <html>/<body>: a host page or browser extension can put attributes like data-theme on them,
  // which would otherwise swallow every tap.
  const el = (sel) => { const m = e.target.closest?.(sel); return m && m !== document.documentElement && m !== document.body ? m : null; };
  if (el('[data-close]')) { closeSheet(); return; }
  const nav = el('a[href^="#"]');
  if (nav) { e.preventDefault(); closeSheet(); go(nav.getAttribute('href').slice(1) || 'home'); return; }
  const player = el('.js-player');
  if (player) { e.preventDefault(); closeSheet(); go('p=' + encodeURIComponent(player.dataset.player)); return; }
  const me = el('[data-me]');
  if (me) { state.me = me.dataset.me; store.set('me', state.me); render(); return; }
  if (el('#switch-me')) { state.me = null; store.set('me', null); go('profile'); return; }
  if (el('#open-theme')) { openSheet(themeSheetHTML()); return; }
  const th = el('[data-theme]');
  if (th) {
    state.themeId = th.dataset.theme === 'auto' ? null : th.dataset.theme;
    store.set('theme', state.themeId);
    applyTheme();
    modal.querySelectorAll('[data-theme]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.theme === activeThemeId()));
    return;
  }
  if (el('#share-week')) { openSheet(recapHTML()); return; }
  const ex = el('[data-explain]');
  if (ex) { openSheet(explainSheet([ex.dataset.explain], E.EXPLAIN[ex.dataset.explain]?.[0] || 'Stat')); return; }
  const exv = el('[data-explain-view]');
  if (exv) { const v = VIEWS[exv.dataset.explainView]; openSheet(explainSheet(v.cols.map(([k]) => k), `${v.label} stats`)); return; }
  if (el('#recap-copy')) { copyRecap(); return; }
  const seg = el('[data-mode],[data-period]');
  if (seg) {
    if (seg.dataset.mode) { state.mode = seg.dataset.mode; state.sort = { key: VIEWS[seg.dataset.mode]?.sort || 'rating', dir: -1 }; }
    if (seg.dataset.period) state.period = seg.dataset.period;
    render(); return;
  }
  const xb = el('[data-x]');
  if (xb) { expAction(xb); return; }
  const an = el('[data-an]');
  if (an) { state.anView = an.dataset.an; go('analytics'); return; }
  const fm = el('[data-fm]');
  if (fm) { $('x-formation').value = fm.dataset.fm; modal.querySelectorAll('[data-fm]').forEach((b) => b.setAttribute('aria-pressed', b === fm)); return; }
  const oc = el('[data-oc]');
  if (oc) { modal.querySelectorAll('[data-oc]').forEach((b) => b.setAttribute('aria-pressed', b === oc)); return; }
  const rl = el('[data-role]');
  if (rl) { state.role = rl.dataset.role; render(); return; }
  const rng = el('[data-range]');
  if (rng) { state.cmp.range = rng.dataset.range === 'all' ? 'all' : Number(rng.dataset.range); render(); return; }
  const sort = el('th button[data-sort]');
  if (sort) {
    const k = sort.dataset.sort;
    state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : k === 'name' ? 1 : -1 };
    render(); return;
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'week-pick') { state.week = e.target.value; render(); }
  if (e.target.id === 'cmp-a') { state.cmp.a = e.target.value; render(); }
  if (e.target.id === 'cmp-b') { state.cmp.b = e.target.value; render(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
window.addEventListener('hashchange', () => {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (memRoute === h) return; // already rendered by go()
  memRoute = null; closeSheet(); render();
});

/* ---------------- boot ---------------- */
async function main() {
  applyTheme();
  try {
    const [matches, members, club, status, snapIndex, players, events, expFile] = await Promise.all([
      getJSON(BASE + 'matches.json'),
      getJSON(BASE + 'members.json', []),
      getJSON(BASE + 'club.json', null),
      getJSON(BASE + 'status.json', null),
      getJSON(BASE + 'snapshots/index.json', []),
      getJSON(PLAYERS_URL, {}),
      getJSON(BASE + 'events.json', {}),
      getJSON(EXP_URL, null),
    ]);
    PICKS = Object.fromEntries(Object.entries(players || {}).map(([n, v]) => [n, clubId(v)]).filter(([n, v]) => !n.startsWith('_') && v));
    D = { matches, members, club, status, events: events || {}, byWeek: S.groupByWeek(matches, TZ), exps: X.parseFile(expFile) };
    if (!DEMO && store.get('gh')) { // editors read straight from GitHub so they never see a 5-minute-old copy
      try { const cur = await X.loadExperiments(ghOpts()); D.exps = { list: cur.list, error: cur.error }; } catch { /* fall back to the public copy */ }
    }
    if (snapIndex.length >= 2) {
      const latest = snapIndex[snapIndex.length - 1];
      const cutoff = S.addDays(latest, -7);
      const older = [...snapIndex].reverse().find((d) => d <= cutoff) ?? snapIndex[0];
      if (older !== latest) {
        const [a, b] = await Promise.all([getJSON(`${BASE}snapshots/${latest}.json`, []), getJSON(`${BASE}snapshots/${older}.json`, [])]);
        D.careerDelta = S.careerDeltas(a, b);
        D.careerSince = older;
      }
    }
    if (state.me && !D.members.some((m) => m.name === state.me) && !matches.some((m) => m.players.some((p) => p.name === state.me))) {
      state.me = null; store.set('me', null); // player left the club
    }
  } catch (e) {
    $('view').innerHTML = `<div class="page-title"><h1>Madras FC</h1><p class="muted">Couldn’t load the stats right now. If this is a brand-new site, the updater may not have run yet — check the repo’s Actions tab, then refresh.</p></div>`;
    console.error(e);
    return;
  }
  renderBanner();
  render();
}
main();

// fade hint on wide tables: hide once scrolled to the right edge
document.addEventListener('scroll', (e) => {
  const el = e.target;
  if (el?.classList?.contains('table-wrap')) el.parentElement.classList.toggle('end', el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
}, true);

// clear a stale form message as soon as the editor types again
document.addEventListener('input', (e) => { if (e.target.closest?.('.sheet') && $('x-msg')) $('x-msg').textContent = ''; });
