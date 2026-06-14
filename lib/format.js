'use strict';

/** ANSI colors (disabled when NO_COLOR is set). */
const useColor = !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));

const colors = {
  dim: (s) => c('2', s),
  bold: (s) => c('1', s),
  red: (s) => c('31', s),
  green: (s) => c('32', s),
  yellow: (s) => c('33', s),
  cyan: (s) => c('36', s),
  gray: (s) => c('90', s),
};

/** Compact human number: 1234 -> 1.2k, 1500000 -> 1.5M */
function humanNumber(n) {
  n = Number(n) || 0;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'k';
  return (n / 1_000_000).toFixed(1) + 'M';
}

/** Format a USD amount: 0.0423 -> $0.04, 12.5 -> $12.50 */
function usd(n) {
  n = Number(n) || 0;
  if (n < 0.01 && n > 0) return '$' + n.toFixed(4);
  return '$' + n.toFixed(2);
}

/**
 * Render a unicode progress bar.
 * @param {number} pct  0..1
 * @param {number} width number of cells
 */
function bar(pct, width = 10) {
  pct = Math.max(0, Math.min(1, pct || 0));
  const filled = Math.round(pct * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** Pick a color function for a fill ratio (green < 0.6 < yellow < 0.85 < red). */
function ratioColor(pct) {
  if (pct >= 0.85) return colors.red;
  if (pct >= 0.6) return colors.yellow;
  return colors.green;
}

module.exports = { colors, humanNumber, usd, bar, ratioColor, useColor };
