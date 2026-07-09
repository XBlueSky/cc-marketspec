// WCAG AA verification for the Live Run dark palette. Run: node scripts/check-contrast.mjs
// Every text/background pair used by the site must appear here and pass.
const L = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [l1, l2] = [L(a), L(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
const T = {
  bg: '#0A0E14', surface: '#101722', chip: '#1A2433', termbg: '#070B11',
  fg: '#E6EDF6', muted: '#95A1B4',
  accent: '#FF7A45', accentInk: '#FF9066', onAccent: '#190D06',
  ok: '#3DDC84', trap: '#FF7B6B',
  synString: '#C9D4E3', synComment: '#8493A8',
};
const checks = [
  ['fg on bg', T.fg, T.bg, 4.5], ['fg on surface', T.fg, T.surface, 4.5], ['fg on chip', T.fg, T.chip, 4.5],
  ['muted on bg', T.muted, T.bg, 4.5], ['muted on surface', T.muted, T.surface, 4.5],
  ['muted on chip', T.muted, T.chip, 4.5], ['muted on termbg', T.muted, T.termbg, 4.5],
  ['accentInk on bg', T.accentInk, T.bg, 4.5], ['accentInk on surface', T.accentInk, T.surface, 4.5],
  ['accentInk on chip', T.accentInk, T.chip, 4.5], ['accentInk on termbg', T.accentInk, T.termbg, 4.5],
  ['accent on bg (large text only)', T.accent, T.bg, 3.0],
  ['onAccent on accent (button)', T.onAccent, T.accent, 4.5],
  ['ok on bg', T.ok, T.bg, 4.5], ['ok on surface', T.ok, T.surface, 4.5], ['ok on termbg', T.ok, T.termbg, 4.5],
  ['trap on surface', T.trap, T.surface, 4.5],
  ['synString on termbg', T.synString, T.termbg, 4.5],
  ['synComment on termbg', T.synComment, T.termbg, 4.5], ['synComment on surface', T.synComment, T.surface, 4.5],
  ['accent focus ring vs bg (non-text)', T.accent, T.bg, 3.0],
];
let fail = 0;
for (const [name, f, b, min] of checks) {
  const r = ratio(f, b);
  if (r < min) fail++;
  console.log(`${r >= min ? 'PASS' : 'FAIL'} ${r.toFixed(2).padStart(6)} (min ${min}) ${name}`);
}
if (fail) { console.error(`${fail} FAILURES`); process.exit(1); }
console.log('ALL PASS');
