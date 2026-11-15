// Club colours for themes and player badges.
// Colours only — official club crests are trademarks, so badges are original two-tone shields.

export const CLUBS = {
  madras:    { label: 'Madras FC',   c1: '#111111', c2: '#e9c43b' },
  barca:     { label: 'Barcelona',   c1: '#A50044', c2: '#004D98' },
  arsenal:   { label: 'Arsenal',     c1: '#D50006', c2: '#023474' },
  united:    { label: 'Man United',  c1: '#DA291C', c2: '#111111' },
  real:      { label: 'Real Madrid', c1: '#F2F2F2', c2: '#00529F' },
  liverpool: { label: 'Liverpool',   c1: '#C8102E', c2: '#00B2A9' },
  chelsea:   { label: 'Chelsea',     c1: '#034694', c2: '#DBA111' },
  city:      { label: 'Man City',    c1: '#6CABDD', c2: '#1C2C5B' },
};

export const CLUB_ORDER = ['madras', 'barca', 'arsenal', 'united', 'real', 'liverpool', 'chelsea', 'city'];

// Dark app themes. accent = fills (with onAccent text on top), accentText = coloured text on surfaces.
export const THEMES = {
  madras:    { bg: '#0b0b0c', surface: '#17171a', surface2: '#202024', border: '#2d2d32', text: '#f3f2ec', muted: '#a3a196', accent: '#e9c43b', onAccent: '#161200', accentText: '#e9c43b', stripeA: '#e9c43b', stripeB: '#111111', glow: '#2a2410' },
  barca:     { bg: '#0a0e1c', surface: '#131a31', surface2: '#1c2442', border: '#2a355c', text: '#f2f4fb', muted: '#a3abc6', accent: '#A50044', onAccent: '#ffffff', accentText: '#EDBB00', stripeA: '#A50044', stripeB: '#004D98', glow: '#2a1030' },
  arsenal:   { bg: '#0f0d0e', surface: '#1b1718', surface2: '#262022', border: '#3b3134', text: '#f7f2f2', muted: '#b0a4a6', accent: '#D50006', onAccent: '#ffffff', accentText: '#ff8a8a', stripeA: '#D50006', stripeB: '#f5f5f5', glow: '#2e0d0f' },
  united:    { bg: '#0c0a0a', surface: '#1a1515', surface2: '#251e1e', border: '#3b2f2f', text: '#f7f1ef', muted: '#ad9f9c', accent: '#DA291C', onAccent: '#ffffff', accentText: '#FBE122', stripeA: '#DA291C', stripeB: '#111111', glow: '#2e110d' },
  real:      { bg: '#0a0f1d', surface: '#141b30', surface2: '#1c2540', border: '#2b3656', text: '#f6f7fb', muted: '#a6aec6', accent: '#FEBE10', onAccent: '#1a1300', accentText: '#FEBE10', stripeA: '#f2f2f2', stripeB: '#00529F', glow: '#1b2340' },
  liverpool: { bg: '#0f0a0b', surface: '#1c1315', surface2: '#271b1e', border: '#3d2b2f', text: '#f8f1f2', muted: '#b1a2a5', accent: '#C8102E', onAccent: '#ffffff', accentText: '#3fd2c7', stripeA: '#C8102E', stripeB: '#00B2A9', glow: '#2b0f15' },
  chelsea:   { bg: '#070c1a', surface: '#101932', surface2: '#18233f', border: '#26355a', text: '#f1f4fb', muted: '#a0abc6', accent: '#034694', onAccent: '#ffffff', accentText: '#DBA111', stripeA: '#034694', stripeB: '#DBA111', glow: '#0d1d40' },
  city:      { bg: '#0a1120', surface: '#131d36', surface2: '#1b2846', border: '#293b63', text: '#f0f5fc', muted: '#a2b2ca', accent: '#6CABDD', onAccent: '#0b1528', accentText: '#8cc3ea', stripeA: '#6CABDD', stripeB: '#1C2C5B', glow: '#142a4a' },
};

/** Three-letter tag shown on a player's badge (e.g. AkshKN → AKS). */
export const tagFor = (name) => String(name || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '?';

/** Accepts club ids or common names ("Barcelona", "man utd") from players.json. */
export function clubId(value) {
  if (!value) return null;
  const v = String(value).toLowerCase().replace(/[^a-z]/g, '');
  if (CLUBS[v]) return v;
  const alias = {
    barcelona: 'barca', fcbarcelona: 'barca', manunited: 'united', manutd: 'united', manchesterunited: 'united',
    realmadrid: 'real', mancity: 'city', manchestercity: 'city', lfc: 'liverpool', cfc: 'chelsea', afc: 'arsenal',
  };
  return alias[v] || null;
}
