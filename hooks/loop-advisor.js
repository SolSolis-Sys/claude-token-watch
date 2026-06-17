#!/usr/bin/env node
'use strict';

/**
 * UserPromptSubmit hook — 5h token threshold advisory for loops.
 *
 * Reads the disk cache written by usage-api.js (no API call, no 429 risk).
 * When 5h utilization exceeds TOKEN_WATCH_LOOP_PCT (default 80%), injects:
 *   - additionalContext: machine-readable advisory the agent can act on
 *     (defer long tasks, wrap up cleanly before reset)
 *   - systemMessage: visible banner for the user
 *
 * No-op when:
 *   - Disk cache is absent or corrupt
 *   - 5h utilization is below threshold
 *   - TOKEN_WATCH_LOOP_ADVISOR=0 (opt-out)
 *
 * TOKEN_WATCH_LOOP_PCT   — threshold % (0-100, default 80)
 * TOKEN_WATCH_LOOP_ADVISOR=0 — disable this hook entirely
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const CACHE_FILE = path.join(os.homedir(), '.claude', 'token-watch', 'usage-cache.json');

function readDiskCache() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.fetchedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Format a UTC ISO string as local HH:MM */
function localTime(isoStr) {
  if (!isoStr) return null;
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}

/** Minutes remaining until a UTC ISO timestamp (negative = already passed) */
function minutesUntil(isoStr) {
  if (!isoStr) return null;
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return null;
    return Math.round((d.getTime() - Date.now()) / 60000);
  } catch {
    return null;
  }
}

function main() {
  if (process.env.TOKEN_WATCH_LOOP_ADVISOR === '0') {
    process.exit(0);
  }

  const threshold = Math.max(1, Math.min(99, Number(process.env.TOKEN_WATCH_LOOP_PCT) || 80)) / 100;

  const disk = readDiskCache();
  if (!disk || !disk.data) {
    process.exit(0);
  }

  const { session5hPct, resetsSession } = disk.data;
  if (typeof session5hPct !== 'number' || session5hPct < threshold) {
    process.exit(0);
  }

  const pctDisplay = Math.round(session5hPct * 100);
  const minsLeft   = minutesUntil(resetsSession);
  const resetAt    = localTime(resetsSession);

  const imminent = minsLeft !== null && minsLeft <= 15;

  // Build the time string
  let timeStr = '';
  if (minsLeft !== null && minsLeft > 0) {
    timeStr = ` — reset in ${minsLeft}min${resetAt ? ` (${resetAt})` : ''}`;
  } else if (resetAt) {
    timeStr = ` — reset at ${resetAt}`;
  }

  const advisory = imminent
    ? `[token-watch] 5h quota at ${pctDisplay}%${timeStr}. Reset imminent — do NOT start a new autonomous loop. Wrap up current work cleanly.`
    : `[token-watch] 5h quota at ${pctDisplay}%${timeStr}. Long autonomous loops risk interruption before reset. If planning a multi-step task (>5min), consider completing current work and resuming after the reset.`;

  const banner = imminent
    ? `⛔ token-watch: 5h at ${pctDisplay}%${timeStr} — do not start loops`
    : `⏱ token-watch: 5h at ${pctDisplay}%${timeStr}`;

  process.stdout.write(JSON.stringify({
    additionalContext: advisory,
    systemMessage: banner,
  }));
  process.exit(0);
}

main();
