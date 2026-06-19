#!/usr/bin/env node
'use strict';

/**
 * UserPromptSubmit hook — 5h token threshold advisory for loops.
 *
 * Reads the disk cache written by usage-api.js (no API call, no 429 risk).
 * When 5h utilization exceeds TOKEN_WATCH_LOOP_PCT (default 80%), injects:
 *   - additionalContext: machine-readable advisory the agent can act on
 *     (defer long tasks, wrap up cleanly before reset). Includes session cost
 *     when a transcript is available, so the advisory reflects actual billing
 *     spend alongside the quota gauge (issue #3).
 *   - systemMessage: visible banner for the user
 *
 * No-op when:
 *   - Disk cache is absent or corrupt
 *   - 5h utilization is below threshold
 *   - TOKEN_WATCH_LOOP_ADVISOR=0 (opt-out)
 *
 * TOKEN_WATCH_LOOP_PCT           — threshold % (0-100, default 80)
 * TOKEN_WATCH_LOOP_IMMINENT_MINS — minutes remaining considered "imminent" (default 15)
 * TOKEN_WATCH_LOOP_ADVISOR=0     — disable this hook entirely
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { CACHE_FILE } = require('../lib/usage-api');
const { readTranscript, aggregate } = require('../lib/transcript');
const { usd } = require('../lib/format');

/** Default imminent threshold in minutes. Overridable for testing and power-users. */
const DEFAULT_IMMINENT_MINS = 15;

/** Minimum gap between two consecutive advisories (cross-hook cooldown). */
const ADVISORY_COOLDOWN_MS = 60 * 1000; // 60 seconds
const ADVISORY_CACHE_FILE = path.join(os.homedir(), '.claude', 'token-watch', 'loop-advisor-last.json');

function readLastAdvisory() {
  try {
    const raw = fs.readFileSync(ADVISORY_CACHE_FILE, 'utf8');
    const p = JSON.parse(raw);
    return typeof p.ts === 'number' ? p.ts : 0;
  } catch { return 0; }
}

function writeLastAdvisory() {
  try {
    fs.mkdirSync(path.dirname(ADVISORY_CACHE_FILE), { recursive: true });
    fs.writeFileSync(ADVISORY_CACHE_FILE, JSON.stringify({ ts: Date.now() }));
  } catch { /* best-effort */ }
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

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

/**
 * Compute the cumulative session cost from the transcript file.
 * Returns a USD string (e.g. "$1.23") or null if unavailable.
 */
function sessionCostLabel(transcriptPath) {
  if (!transcriptPath) return null;
  try {
    const records = readTranscript(transcriptPath);
    if (!records || records.length === 0) return null;
    const totals = aggregate(records);
    if (totals.cost <= 0) return null;
    return usd(totals.cost);
  } catch {
    return null;
  }
}

function main() {
  if (process.env.TOKEN_WATCH_LOOP_ADVISOR === '0') {
    process.exit(0);
  }

  const threshold = Math.max(1, Math.min(99, Number(process.env.TOKEN_WATCH_LOOP_PCT) || 80)) / 100;
  const imminentMins = Math.max(1, Number(process.env.TOKEN_WATCH_LOOP_IMMINENT_MINS) || DEFAULT_IMMINENT_MINS);

  const disk = readDiskCache();
  if (!disk || !disk.data) {
    process.exit(0);
  }

  const { session5hPct, resetsSession } = disk.data;
  if (typeof session5hPct !== 'number' || session5hPct < threshold) {
    process.exit(0);
  }

  // Read transcript path from stdin (hook payload).
  let input = {};
  try { input = JSON.parse(readStdin() || '{}'); } catch { input = {}; }
  const transcriptPath = input.transcript_path || null;

  const pctDisplay = Math.round(session5hPct * 100);
  const minsLeft   = minutesUntil(resetsSession);
  const resetAt    = localTime(resetsSession);
  const costLabel  = sessionCostLabel(transcriptPath);

  const imminent = minsLeft !== null && minsLeft <= imminentMins;

  // Cooldown — prevents double-firing when both UserPromptSubmit and Stop
  // trigger loop-advisor within the same interaction (interactive mode).
  const lastAdvisory = readLastAdvisory();
  if (Date.now() - lastAdvisory < ADVISORY_COOLDOWN_MS) {
    process.exit(0);
  }

  // Build the time string
  let timeStr = '';
  if (minsLeft !== null && minsLeft > 0) {
    timeStr = ` — reset in ${minsLeft}min${resetAt ? ` (${resetAt})` : ''}`;
  } else if (resetAt) {
    timeStr = ` — reset at ${resetAt}`;
  }

  // Build optional cost string
  const costStr = costLabel ? ` · session cost ${costLabel}` : '';

  const advisory = imminent
    ? `[token-watch] 5h quota at ${pctDisplay}%${timeStr}${costStr}. Reset imminent — do NOT start a new autonomous loop. Wrap up current work cleanly.`
    : `[token-watch] 5h quota at ${pctDisplay}%${timeStr}${costStr}. Long autonomous loops risk interruption before reset. If planning a multi-step task (>5min), consider completing current work and resuming after the reset.`;

  const banner = imminent
    ? `⛔ token-watch: 5h at ${pctDisplay}%${timeStr}${costStr} — do not start loops`
    : `⏱ token-watch: 5h at ${pctDisplay}%${timeStr}${costStr}`;

  writeLastAdvisory();

  // Determine which hook event triggered this invocation (UserPromptSubmit or Stop).
  // The Stop hook payload does not include a hookEventName, so we fall back to
  // 'UserPromptSubmit' to remain compatible with the existing advisory schema.
  const hookEventName = input.hook_event_name || 'UserPromptSubmit';

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName,
      additionalContext: advisory,
    },
    systemMessage: banner,
  }));
  process.exit(0);
}

main();
