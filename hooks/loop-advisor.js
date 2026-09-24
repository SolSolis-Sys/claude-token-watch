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
 * Crossing TOKEN_WATCH_QUOTA_ALERT_PCT (default 90%) escalates the same output
 * into an explicit 5h quota alert: the advisory names the crossed threshold, and
 * a crossing is emitted even if the loop advisory fired seconds earlier.
 *
 * No-op when:
 *   - Disk cache is absent or corrupt
 *   - 5h utilization is below both thresholds
 *   - TOKEN_WATCH_LOOP_ADVISOR=0 (opt-out)
 *
 * TOKEN_WATCH_LOOP_PCT           — loop advisory threshold % (0-100, default 80)
 * TOKEN_WATCH_QUOTA_ALERT_PCT    — 5h quota alert threshold % (0-100, default 90)
 * TOKEN_WATCH_LOOP_IMMINENT_MINS — minutes remaining considered "imminent" (default 15)
 * TOKEN_WATCH_LOOP_ADVISOR=0     — disable this hook entirely
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { CACHE_FILE } = require('../lib/usage-api');
const { loadConfig } = require('../lib/config');
const { readTranscript, aggregate } = require('../lib/transcript');
const { usd } = require('../lib/format');

/** Default imminent threshold in minutes. Overridable for testing and power-users. */
const DEFAULT_IMMINENT_MINS = 15;

/** Fallbacks when a configured threshold is missing or not a usable number. */
const DEFAULT_LOOP_PCT = 80;
const DEFAULT_QUOTA_ALERT_PCT = 90;

/** Same session: minimum gap between two advisories of the same level. Long
 *  enough to absorb the UserPromptSubmit+Stop double-fire of one interaction,
 *  short enough that a sustained overrun is never hidden for long. */
const ADVISORY_RENOTIFY_MS = 30 * 60 * 1000; // 30 minutes
const ADVISORY_CACHE_FILE = path.join(os.homedir(), '.claude', 'token-watch', 'loop-advisor-last.json');

/** Coerce a config/env percentage to a usable 1-100 number, else the fallback. */
function normalizePct(value, fallback) {
  const n = Number(value);
  if (!isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.min(100, n));
}

/** Last advisory state: { sessionId, ts, pct }, or null when unreadable. */
function readLastAdvisory() {
  try {
    const raw = fs.readFileSync(ADVISORY_CACHE_FILE, 'utf8');
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? p : null;
  } catch { return null; }
}

function writeLastAdvisory(state) {
  try {
    fs.mkdirSync(path.dirname(ADVISORY_CACHE_FILE), { recursive: true });
    fs.writeFileSync(ADVISORY_CACHE_FILE, JSON.stringify(state));
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

/**
 * Decide and build the advisory. Pure side-effect-wise except the cooldown
 * state file, and never writes to stdout — so it is testable in-process.
 *
 * @param {Object} input hook payload (session_id, transcript_path, hook_event_name)
 * @returns {{ emit: boolean, output: Object|null }}
 */
function run(input) {
  if (process.env.TOKEN_WATCH_LOOP_ADVISOR === '0') {
    return { emit: false, output: null };
  }

  // Priority: env var > config.yaml > built-in default — via loadConfig().
  // A text/NaN threshold (env or yaml) falls back to its default, never throws.
  const cfg = loadConfig();
  const loopPct  = normalizePct(cfg.loop_pct, DEFAULT_LOOP_PCT);
  const quotaPct = normalizePct(cfg.quota_alert_pct, DEFAULT_QUOTA_ALERT_PCT);
  const threshold = Math.min(loopPct, quotaPct) / 100;
  const imminentMins = Math.max(1, Number(process.env.TOKEN_WATCH_LOOP_IMMINENT_MINS) || DEFAULT_IMMINENT_MINS);

  const disk = readDiskCache();
  if (!disk || !disk.data) {
    return { emit: false, output: null };
  }

  const { session5hPct, resetsSession } = disk.data;
  if (typeof session5hPct !== 'number' || !isFinite(session5hPct) || session5hPct < threshold) {
    return { emit: false, output: null };
  }

  const payload = input && typeof input === 'object' ? input : {};
  const transcriptPath = payload.transcript_path || null;

  const pctDisplay = Math.round(session5hPct * 100);
  const minsLeft   = minutesUntil(resetsSession);
  const resetAt    = localTime(resetsSession);
  const costLabel  = sessionCostLabel(transcriptPath);

  const imminent = minsLeft !== null && minsLeft <= imminentMins;
  const overQuota = session5hPct >= quotaPct / 100;

  // Cooldown — prevents double-firing when both UserPromptSubmit and Stop
  // trigger loop-advisor within the same interaction (interactive mode).
  // It is scoped to the session so it can never swallow the first advisory of a
  // new session, and it can never hide a sustained overrun for more than
  // ADVISORY_RENOTIFY_MS. A fresh quota crossing always goes through.
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
  const last = readLastAdvisory();
  if (last && last.sessionId === sessionId) {
    const elapsed = Date.now() - (typeof last.ts === 'number' ? last.ts : 0);
    const crossing = overQuota && (typeof last.pct !== 'number' || last.pct < quotaPct / 100);
    if (!crossing && elapsed < ADVISORY_RENOTIFY_MS) {
      return { emit: false, output: null };
    }
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

  const tail = imminent
    ? 'Reset imminent — do NOT start a new autonomous loop. Wrap up current work cleanly.'
    : 'Long autonomous loops risk interruption before reset. If planning a multi-step task (>5min), consider completing current work and resuming after the reset.';

  const advisory = overQuota
    ? `[token-watch] 5h quota at ${pctDisplay}% — above your quota alert threshold (quota_alert_pct ${quotaPct}%)${timeStr}${costStr}. ${tail}`
    : `[token-watch] 5h quota at ${pctDisplay}%${timeStr}${costStr}. ${tail}`;

  const banner = imminent
    ? `⛔ token-watch: 5h at ${pctDisplay}%${timeStr}${costStr} — do not start loops`
    : `⏱ token-watch: 5h at ${pctDisplay}%${timeStr}${costStr}`;

  writeLastAdvisory({ sessionId, ts: Date.now(), pct: session5hPct });

  // Determine which hook event triggered this invocation (UserPromptSubmit or Stop).
  // The Stop hook payload does not include a hookEventName, so we fall back to
  // 'UserPromptSubmit' to remain compatible with the existing advisory schema.
  const hookEventName = payload.hook_event_name || 'UserPromptSubmit';

  return {
    emit: true,
    output: {
      hookSpecificOutput: {
        hookEventName,
        additionalContext: advisory,
      },
      systemMessage: banner,
    },
  };
}

function main() {
  let input = {};
  try { input = JSON.parse(readStdin() || '{}'); } catch { input = {}; }
  try {
    const { emit, output } = run(input);
    if (emit && output) process.stdout.write(JSON.stringify(output));
  } catch { /* a hook must never break the session */ }
  process.exit(0);
}

// Direct file execution (`node hooks/loop-advisor.js`) keeps working; the
// manifest dispatches through `node -e`, where require.main is undefined and
// only an explicit `.main()` call can reach the entry.
if (require.main === module) main();

module.exports = { main, run, normalizePct, DEFAULT_QUOTA_ALERT_PCT, DEFAULT_LOOP_PCT };
