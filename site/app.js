import * as S from './stats.js';

const cfg = window.MFC_CONFIG || {};
const TZ = cfg.timeZone || 'America/Chicago';
const qs = new URLSearchParams(location.search);
const BASE = (qs.get('data') || cfg.dataBase || '').replace(/\/?$/, '/');
const NOW = Date.now();
const bust = Math.floor(NOW / 300000); // refresh at most every 5 minutes

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

async function getJSON(name, fallback) {
  try {
    const r = await fetch(`${BASE}${name}?v=${bust}`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw e;
  }
}

const state = { week: null, mode: 'tracked', period: 'all', sort: { key: 'rating', dir: -1 } };
let D; // loaded data

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

/* ---------------- sections ---------------- */
function renderHero() {
  const c = D.club || {};
  const o = c.overall || {};
  const last10 = D.matches.slice(0, 10).reverse();
  const se = c.season;
  const chips = [
    c.currentDivision ? `<span class="chip">Division <b>${c.currentDivision}</b></span>` : '',
    se?.wins != null ? `<span class="chip">This season <b>${se.wins}W ${se.ties}D ${se.losses}L</b></span>` : '',
    o.skillRating ? `<span class="chip">Skill rating <b>${esc(o.skillRating)}</b></span>` : '',
    o.wins != null ? `<span class="chip">All-time <b>${o.wins}W ${o.ties}D ${o.losses}L</b></span>` : '',
    o.goals != null ? `<span class="chip">Goals <b>${o.goals}</b> for · <b>${o.goalsAgainst}</b> against</span>` : '',
  ].join('');
  const form = last10.map((m) => `<span class="pill ${m.result}" title="${esc(`${m.result} ${m.gf}–${m.ga} vs ${m.opp.name}`)}">${m.result}</span>`).join('');
  $('hero').innerHTML = `<div class="wrap">
    <div class="hero-top"><div class="crest" aria-hidden="true">MFC</div>
      <div><h1>${esc(cfg.clubName || c.name || 'Madras FC')} <span>·</span> Club Stats</h1>
      <div class="muted" style="font-size:.85rem">EA FC 27 Pro Clubs · 11v11</div></div></div>
    <div class="chips">${chips}</div>
    ${last10.length ? `<div class="form"><span class="form-label">Last ${last10.length}</span>${form}<span class="form-label" style="margin-left:4px">→ newest</span></div>` : ''}
  </div>`;
}

function renderBanner() {
  const st = D.status;
  const out = [];
  if (st?.lastSuccess) {
    const hrs = (NOW - st.lastSuccess) / 3.6e6;
    if (hrs > (cfg.pollEveryHours || 2) * 4) out.push(`<div class="warn">⚠️ <span>Stats haven't refreshed in ${Math.round(hrs)} hours — EA may be blocking the updater. Recent matches will appear once it recovers (as long as fewer than 10 are played in the meantime).</span></div>`);
  } else if (st && st.ok === false) {
    out.push(`<div class="warn">⚠️ <span>The updater hasn't managed to reach EA yet.</span></div>`);
  }
  const recentGaps = (st?.gaps || []).filter((g) => NOW - g.detectedAt < 14 * 864e5);
  for (const g of recentGaps) out.push(`<div class="info">ℹ️ <span>Some ${esc(g.type)} matches between ${esc(dateFmt.format(g.from * 1000))} and ${esc(dateFmt.format(g.to * 1000))} may be missing — EA only keeps the last 10.</span></div>`);
  $('banner').className = out.length ? 'banner' : '';
  $('banner').innerHTML = out.join('');
}

function deltaHTML(cur, prev, { fmt = (v) => v, better = 1, unit = '' } = {}) {
  if (cur == null || prev == null) return '<div class="delta">&nbsp;</div>';
  const d = cur - prev;
  if (Math.abs(d) < 1e-9) return '<div class="delta">same as last week</div>';
  const good = d * better > 0;
  return `<div class="delta"><span class="${good ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d))}${unit}</span> vs last week</div>`;
}

function renderWeek() {
  const weeks = [...D.byWeek.keys()].sort().reverse();
  if (!weeks.length) { $('week').innerHTML = '<h2 id="week-h">This week</h2><p class="empty">No matches tracked yet — they’ll appear after your next league game.</p>'; return; }
  if (!state.week) state.week = weeks[0];
  const cur = S.summarize(D.byWeek.get(state.week) || []);
  const prevKey = S.addDays(state.week, -7);
  const prev = D.byWeek.has(prevKey) ? S.summarize(D.byWeek.get(prevKey)) : null;
  const isThis = state.week === S.weekKey(NOW / 1000, TZ);
  const opts = weeks.map((k) => `<option value="${k}" ${k === state.week ? 'selected' : ''}>${k === S.weekKey(NOW / 1000, TZ) ? 'This week' : weekLabel(k)}</option>`).join('');
  $('week').innerHTML = `<div class="week-head"><h2 id="week-h">${isThis ? 'This week' : weekLabel(state.week)} <span class="sub">vs the week before</span></h2>
      <label><span class="muted" style="font-size:.8rem;margin-right:6px">Week</span><select id="week-pick">${opts}</select></label></div>
    <div class="kpis">
      <div class="kpi"><div class="label">Matches</div><div class="value num">${cur.n}</div>${deltaHTML(cur.n, prev?.n, { better: 0 })}</div>
      <div class="kpi"><div class="label">Record</div><div class="value num">${cur.w}-${cur.d}-${cur.l}</div><div class="delta">${prev ? `last week ${prev.w}-${prev.d}-${prev.l}` : 'W-D-L'}</div></div>
      <div class="kpi"><div class="label">Win rate</div><div class="value num">${pct(cur.winPct)}</div>${deltaHTML(cur.winPct, prev?.winPct, { fmt: (v) => Math.round(v * 100), unit: ' pts' })}</div>
      <div class="kpi"><div class="label">Goals / game</div><div class="value num">${fx(cur.gfPer)} <span class="muted" style="font-size:.9rem">for</span></div><div class="delta">${fx(cur.gaPer)} against${prev ? ` · was ${fx(prev.gfPer)} / ${fx(prev.gaPer)}` : ''}</div></div>
      <div class="kpi"><div class="label">Team rating</div><div class="value num">${fx(cur.rating, 2)}</div>${deltaHTML(cur.rating, prev?.rating, { fmt: (v) => v.toFixed(2) })}</div>
    </div>`;
  $('week-pick').addEventListener('change', (e) => { state.week = e.target.value; renderWeek(); renderAwards(); renderPlayers(); });
}

const AWARD_ICON = { potw: '👑', boot: '👟', playmaker: '🎯', wall: '🧱', passer: '📐', ironman: '⏱️', improved: '📈' };
function renderAwards() {
  const ms = D.byWeek.get(state.week) || [];
  const prev = D.byWeek.get(S.addDays(state.week || '', -7)) || [];
  const awards = S.weeklyAwards(ms, prev);
  let career = '';
  if (D.careerDelta?.length) {
    career = `<div class="card" style="margin-top:12px"><h3>Career gains since ${esc(dateFmt.format(new Date(D.careerSince + 'T12:00:00Z')))} <span class="muted" style="font-weight:400">(EA totals — every match type)</span></h3>
      <ul class="list">${D.careerDelta.sort((a, b) => b.goals + b.assists - (a.goals + a.assists)).map((d) => `<li><span><b>${esc(d.name)}</b> <span class="k">+${d.games} games</span></span><span class="v num">+${d.goals}G +${d.assists}A${d.mom ? ` · +${d.mom} MOTM` : ''}</span></li>`).join('')}</ul></div>`;
  }
  $('awards').innerHTML = `<div class="awards-head"><h2 id="awards-h">🏆 Awards <span class="sub">${state.week ? esc(weekLabel(state.week)) : ''}</span></h2></div>
    ${awards.length ? `<div class="awards">${awards.map((a) => `<div class="award"><div class="icon" aria-hidden="true">${AWARD_ICON[a.key] || '⭐'}</div><div class="title">${esc(a.title)}</div>
      <div class="who">${a.names.map(esc).join(', ')}${a.names.length > 1 ? ' <span class="muted" style="font-weight:500;font-size:.8rem">(shared)</span>' : ''}</div><div class="val num">${esc(a.value)}</div><div class="blurb">${esc(a.blurb)}</div></div>`).join('')}</div>` : '<p class="empty">No awards this week yet.</p>'}
    ${career}`;
}

function renderCharts() {
  const recent = D.matches.slice(0, 15).reverse();
  const weekly = S.weeklySeries(D.matches, TZ);
  const barCard = `<div class="card chart-card"><h2>Recent matches <span class="sub">goals per game</span></h2>
    <div class="legend"><span><span class="swatch" style="background:var(--scored)"></span>Scored</span><span><span class="swatch" style="background:var(--conceded)"></span>Conceded</span><span class="muted">Tap a match for details</span></div>
    ${recent.length ? barChart(recent) : '<p class="empty">No matches yet.</p>'}</div>`;
  let trend;
  if (weekly.length < 2) {
    trend = `<div class="card chart-card"><h2>Week-over-week</h2><p class="empty">Trends appear once you’ve played in two different weeks.${weekly[0] ? ` Tracking started ${esc(weekLabel(weekly[0].week).replace('Week of ', 'the week of '))}.` : ''}</p>
      <p class="note">Charts here: win rate, goals for &amp; against per game, and average team rating — one point per week.</p></div>`;
  } else {
    const labels = weekly.map((w) => dateFmt.format(new Date(w.week + 'T12:00:00Z')));
    trend = `<div class="card chart-card"><h2>Week-over-week <span class="sub">${weekly.length} weeks</span></h2><div class="small-multiples">
      <div><div class="sm-title">Win rate</div>${lineChart({ labels, series: [{ name: 'Win rate', color: 'var(--line)', values: weekly.map((w) => w.winPct) }], fmt: (v) => `${Math.round(v * 100)}%`, min: 0, max: 1, step: 0.25 })}</div>
      <div><div class="sm-title">Goals per game</div><div class="legend"><span><span class="swatch" style="background:var(--scored)"></span>For</span><span><span class="swatch" style="background:var(--conceded)"></span>Against</span></div>${lineChart({ labels, series: [{ name: 'For', color: 'var(--scored)', values: weekly.map((w) => w.gfPer) }, { name: 'Against', color: 'var(--conceded)', values: weekly.map((w) => w.gaPer) }], fmt: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)) })}</div>
      <div><div class="sm-title">Average team rating</div>${lineChart({ labels, series: [{ name: 'Team rating', color: 'var(--line)', values: weekly.map((w) => w.rating) }], fmt: (v) => v.toFixed(0), min: 5, max: 10, step: 1 })}</div>
    </div></div>`;
  }
  $('charts').innerHTML = barCard + trend;
  wireCharts($('charts'));
}

const TRACKED_COLS = [
  ['name', 'Player'], ['apps', 'Apps'], ['g', 'G'], ['a', 'A'], ['gaPerGame', 'G+A/gm'], ['rating', 'Rating'],
  ['passPct', 'Pass %'], ['tacklePct', 'Tackle %'], ['sh', 'Shots'], ['mom', 'MOTM'], ['winPct', 'Win %'],
];
const CAREER_COLS = [
  ['name', 'Player'], ['gamesPlayed', 'GP'], ['goals', 'G'], ['assists', 'A'], ['ratingAve', 'Rating'],
  ['passSuccessRate', 'Pass %'], ['tackleSuccessRate', 'Tackle %'], ['shotSuccessRate', 'Shot %'], ['manOfTheMatch', 'MOTM'], ['winRate', 'Win %'], ['proOverall', 'OVR'],
];
function cell(key, r) {
  const v = r[key];
  if (key === 'name') return `<span class="pname">${esc(v)}</span>${r.mainPos || r.favoritePosition ? `<span class="pos">${esc((r.mainPos || r.favoritePosition).slice(0, 3).toUpperCase())}</span>` : ''}`;
  if (['passPct', 'tacklePct', 'winPct'].includes(key)) return pct(v);
  if (['passSuccessRate', 'tackleSuccessRate', 'shotSuccessRate', 'winRate'].includes(key)) return v == null ? '–' : `${v}%`;
  if (key === 'rating' || key === 'gaPerGame') return fx(v, 2);
  if (key === 'ratingAve') return fx(v, 1);
  return v ?? '–';
}
function renderPlayers() {
  const career = state.mode === 'career';
  const cols = career ? CAREER_COLS : TRACKED_COLS;
  const src = career ? D.members : S.playerTable(state.period === 'week' ? D.byWeek.get(state.week) || [] : D.matches);
  const { key, dir } = state.sort;
  const rows = [...src].sort((a, b) => {
    const va = a[key], vb = b[key];
    if (typeof va === 'string' || typeof vb === 'string') return dir * String(va ?? '').localeCompare(String(vb ?? ''), undefined, { sensitivity: 'base' });
    return dir * ((va ?? -Infinity) - (vb ?? -Infinity));
  });
  const th = cols.map(([k, label]) => `<th scope="col" ${k === key ? `aria-sort="${dir < 0 ? 'descending' : 'ascending'}"` : ''}><button data-k="${k}">${label}${k === key ? (dir < 0 ? ' ↓' : ' ↑') : ''}</button></th>`).join('');
  const body = rows.map((r) => `<tr>${cols.map(([k]) => `<td class="num">${cell(k, r)}</td>`).join('')}</tr>`).join('');
  const tab = (attr, val, label) => `<button class="tab" data-${attr}="${val}" aria-pressed="${state[attr] === val}">${label}</button>`;
  $('players').innerHTML = `<h2 id="players-h">Players</h2>
    <div class="tabs">${tab('mode', 'tracked', 'Tracked league matches')}${tab('mode', 'career', 'Career (EA totals)')}
      ${career ? '' : `<span style="width:8px"></span>${tab('period', 'all', 'All')}${tab('period', 'week', state.week ? weekLabel(state.week).replace('Week of ', 'Wk ') : 'Week')}`}</div>
    ${rows.length ? `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>` : '<p class="empty">No data for this view yet.</p>'}
    <p class="note">${career ? 'Career totals come straight from EA and include matches from before tracking started.' : 'Only counts appearances with game time. Tap a column to sort.'}</p>`;
  $('players').querySelectorAll('th button').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.k;
    state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : k === 'name' ? 1 : -1 };
    renderPlayers();
  }));
  $('players').querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    state.sort = { key: state.mode === 'career' ? 'ratingAve' : 'rating', dir: -1 };
    renderPlayers();
  }));
  $('players').querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', () => { state.period = b.dataset.period; renderPlayers(); }));
}

function renderDefence() {
  const t = S.playerTable(D.matches).sort((a, b) => (a.concededPer90 ?? 99) - (b.concededPer90 ?? 99));
  const s = S.summarize(D.matches);
  $('defence').innerHTML = `<h2 id="defence-h">🛡️ Defence <span class="sub">${s.cleanSheets} clean sheet${s.cleanSheets === 1 ? '' : 's'} in ${s.n} tracked</span></h2>
    <div class="table-wrap"><table><thead><tr><th>Player</th><th>Tackles won</th><th>Tackle %</th><th>Conceded / 90 on pitch</th><th>Clean sheets</th><th>Mins</th></tr></thead>
    <tbody>${t.map((r) => `<tr><td>${cell('name', r)}</td><td class="num">${r.tm}</td><td class="num">${pct(r.tacklePct)}</td><td class="num">${fx(r.concededPer90, 2)}</td><td class="num">${r.cs}</td><td class="num">${r.mins}</td></tr>`).join('')}</tbody></table></div>
    <p class="note">“Conceded / 90” = goals the team let in while that player was on the pitch, per full match. EA doesn’t share interceptions, blocks or dribbles.</p>`;
}

function renderExtras() {
  const r = S.records(D.matches);
  const rec = [];
  const mline = (m) => `${m.gf}–${m.ga} vs ${esc(m.opp.name)}`;
  if (r.bigWin) rec.push(['Biggest win', mline(r.bigWin), dateFmt.format(r.bigWin.ts * 1000)]);
  if (r.bigLoss) rec.push(['Heaviest loss', mline(r.bigLoss), dateFmt.format(r.bigLoss.ts * 1000)]);
  if (r.bestRating) rec.push(['Best match rating', `${esc(r.bestRating.name)} · ${r.bestRating.rt.toFixed(1)}`, `vs ${esc(r.bestRating.m.opp.name)}`]);
  if (r.mostScored) rec.push(['Most goals in a match', `${esc(r.mostScored.name)} · ${r.mostScored.g}`, `vs ${esc(r.mostScored.m.opp.name)}`]);
  rec.push(['Longest win streak', `${r.winStreak.best}`, `current: ${r.winStreak.current}`]);
  rec.push(['Longest unbeaten run', `${r.unbeaten.best}`, `current: ${r.unbeaten.current}`]);
  const recCard = `<div class="card"><h2>📜 Records</h2><ul class="list">${rec.map(([k, v, sub]) => `<li><span><span class="k">${k}</span><br>${v}</span><span class="v k">${sub}</span></li>`).join('')}</ul><p class="note">Forfeits don’t count toward scoreline records.</p></div>`;

  const duos = S.partnerships(D.matches, 3).slice(0, 6);
  const duoCard = `<div class="card"><h2>🤝 Best duos <span class="sub">3+ games together</span></h2>${duos.length ? `<ul class="list">${duos.map((d) => `<li style="display:block"><div style="display:flex;justify-content:space-between;gap:8px"><span><b>${esc(d.a)}</b> + <b>${esc(d.b)}</b></span><span class="v num">${pct(d.winPct)}</span></div><div class="k num">${d.n} games · ${d.w}W ${d.d}D ${d.l}L · ${d.gf}–${d.ga}</div><div class="bar" aria-hidden="true"><i style="width:${Math.round(d.winPct * 100)}%"></i></div></li>`).join('')}</ul>` : '<p class="empty">Needs a few more games together.</p>'}</div>`;

  const h2h = S.headToHead(D.matches).slice(0, 8);
  const h2hCard = `<div class="card"><h2>⚔️ Opponents</h2>${h2h.length ? `<ul class="list">${h2h.map((o) => `<li><span><b>${esc(o.name)}</b><br><span class="k">${o.n} meeting${o.n > 1 ? 's' : ''} · last ${esc(dateFmt.format(o.last * 1000))}</span></span><span class="v num">${o.w}W ${o.d}D ${o.l}L<br><span class="k">${o.gf}–${o.ga}</span></span></li>`).join('')}</ul>` : '<p class="empty">No opponents yet.</p>'}</div>`;
  $('extras').innerHTML = recCard + duoCard + h2hCard;
}

function renderMatches() {
  const list = D.matches.slice(0, 60);
  $('matches').innerHTML = `<h2 id="matches-h">📋 Match log <span class="sub">${D.matches.length} tracked</span></h2>
    ${list.map((m) => {
      const tr = S.teamRating(m);
      const ps = [...m.players].sort((a, b) => (b.sec > 0) - (a.sec > 0) || b.rt - a.rt);
      return `<details class="match"><summary><span class="pill ${m.result}" aria-label="${m.result === 'W' ? 'Win' : m.result === 'L' ? 'Loss' : 'Draw'}">${m.result}</span>
        <span class="score num">${m.gf}–${m.ga}</span>
        <span style="min-width:0"><div class="opp">${esc(m.opp.name)}</div><div class="when">${esc(dtFmt.format(m.ts * 1000))}${m.dnf ? `<span class="tag">${m.dnf === 'them' ? 'they quit' : 'we quit'}</span>` : ''}${m.type !== 'league' ? `<span class="tag">${esc(m.type)}</span>` : ''}</div></span>
        <span class="tr num">${tr ? tr.toFixed(1) : '–'}<div class="when">rating</div></span></summary>
        <div class="detail"><div class="table-wrap"><table><thead><tr><th>Player</th><th>Rating</th><th>G</th><th>A</th><th>Shots</th><th>Passes</th><th>Tackles</th><th>Mins</th></tr></thead><tbody>
        ${ps.map((p) => p.sec > 0
          ? `<tr><td><span class="pname">${esc(p.name)}</span>${p.mom ? ' <span class="star" title="Man of the match">★</span>' : ''}<span class="pos">${esc((p.pos || '').slice(0, 3).toUpperCase())}</span></td><td class="num">${p.rt.toFixed(1)}</td><td class="num">${p.g}</td><td class="num">${p.a}</td><td class="num">${p.sh}</td><td class="num">${p.pm}/${p.pa}</td><td class="num">${p.tm}/${p.ta}</td><td class="num">${Math.round(p.sec / 60)}</td></tr>`
          : `<tr class="dnp"><td>${esc(p.name)}</td><td colspan="7" style="text-align:left">didn’t get on the pitch</td></tr>`).join('')}
        </tbody></table></div></div></details>`;
    }).join('') || '<p class="empty">No matches tracked yet.</p>'}`;
}

function renderFooter() {
  const st = D.status;
  const first = D.matches.length ? D.matches[D.matches.length - 1].ts * 1000 : null;
  $('footer').innerHTML = `${st?.lastSuccess ? `<div>Updated ${esc(ago(st.lastSuccess))}${st.lastNewMatch ? ` · last new match found ${esc(ago(st.lastNewMatch))}` : ''}</div>` : ''}
    ${first ? `<div>Tracking league matches since ${esc(dateFmt.format(first))}.</div>` : ''}
    <div>Data from EA’s unofficial Pro Clubs endpoints. Not affiliated with or endorsed by EA.</div>`;
}

/* ---------------- boot ---------------- */
async function main() {
  try {
    const [matches, members, club, status, snapIndex] = await Promise.all([
      getJSON('matches.json'),
      getJSON('members.json', []),
      getJSON('club.json', null),
      getJSON('status.json', null),
      getJSON('snapshots/index.json', []),
    ]);
    D = { matches, members, club, status, byWeek: S.groupByWeek(matches, TZ) };
    // career week-over-week: latest snapshot vs the newest one at least 7 days older
    if (snapIndex.length >= 2) {
      const latest = snapIndex[snapIndex.length - 1];
      const cutoff = S.addDays(latest, -7);
      const older = [...snapIndex].reverse().find((d) => d <= cutoff) ?? snapIndex[0];
      if (older !== latest) {
        const [a, b] = await Promise.all([getJSON(`snapshots/${latest}.json`, []), getJSON(`snapshots/${older}.json`, [])]);
        D.careerDelta = S.careerDeltas(a, b);
        D.careerSince = older;
      }
    }
  } catch (e) {
    $('hero').innerHTML = `<div class="wrap"><h1 style="margin:0">Madras FC</h1><p class="muted">Couldn’t load the stats right now. If this is a brand-new site, the updater may not have run yet — check the repo’s Actions tab, then refresh.</p></div>`;
    console.error(e);
    return;
  }
  renderHero(); renderBanner(); renderWeek(); renderAwards(); renderCharts(); renderPlayers(); renderDefence(); renderExtras(); renderMatches(); renderFooter();
}
main();
