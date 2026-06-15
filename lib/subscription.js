'use strict';

/**
 * Subscription window tracking for token-watch.
 *
 * Claude paid plans (Pro / Max) meter usage on TWO rolling windows:
 *   - a 5-hour rolling session window, and
 *   - a 7-day (weekly) rolling window introduced in 2025.
 *
 * Anthropic does NOT publish these limits as token counts — they are opaque
 * and effectively message/compute based. So the caps below are deliberate,
 * documented HEURISTICS meant to give a useful "how close am I" gauge, not a
 * billing-accurate number. Override them with real values once you've observed
 * your own ceilings:
 *
 *   TOKEN_WATCH_PLAN          pro | max5 | max20   (selects a preset)
 *   TOKEN_WATCH_SESSION_CAP   token cap for the 5h window  (overrides preset)
 *   TOKEN_WATCH_WEEKLY_CAP    token cap for the 7d window  (overrides preset)
 *
 * Setting a cap to 0 (or leaving plan unset with no env caps) hides the % and
 * shows the raw rolling total instead.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { allTranscripts, readTranscript } = require('./transcript');

const HOUR = 3600 * 1000;
const SESSION_WINDOW_MS = 5 * HOUR;
const WEEKLY_WINDOW_MS = 7 * 24 * HOUR;

/**
 * Token-equivalent caps per plan. Still NOT official Anthropic numbers, but the
 * `pro` row is now EMPIRICALLY CALIBRATED against the real `/usage` panel on a
 * Pro account (two simultaneous readings: 61%/50% and 72%/51% vs measured
 * rolling tokens → session ≈ 3.5M, weekly ≈ 90M). The Max rows are extrapolated
 * from the calibrated Pro baseline at the documented tier ratios (5× / 20×) and
 * remain unverified. Tune via env overrides.
 */
const PLANS = {
  // Calibré empiriquement 2026-06-15 (point 2) : Anthropic 27%/56% = plugin 23%/86%
  // → session cap = 1.09M / 0.27 = 4.0M
  // → weekly cap  = 122.1M / 0.56 = 218M
  pro:   { session5h:  4_000_000, weekly: 218_000_000 },
  max5:  { session5h: 17_500_000, weekly: 450_000_000 },
  max20: { session5h: 70_000_000, weekly: 1_800_000_000 },
};

/** Path of the auto-detected plan cache (written by the SessionEnd hook). */
function planCachePath() {
  return path.join(os.homedir(), '.claude', 'token-watch', 'plan-cache.json');
}

/** TTL before the cached plan is considered stale and re-detected. */
const PLAN_CACHE_TTL_MS = 24 * HOUR;

/**
 * Map an opaque subscription tier string (from `claude auth status --json`) to
 * one of our plan keys. Defensive: works on any field name by scanning the
 * lowercased blob. Returns null when no Max/Pro signal is found.
 */
function tierToPlan(blob) {
  const s = String(blob || '').toLowerCase();
  if (/20\s*x|max[_-]?20/.test(s)) return 'max20';
  if (/5\s*x|max[_-]?5/.test(s)) return 'max5';
  if (/\bmax\b/.test(s)) return 'max5'; // unnumbered "max" → conservative tier
  if (/\bpro\b/.test(s)) return 'pro';
  return null;
}

/**
 * Detect the active plan by asking the Claude CLI for its auth status. This
 * reads ONLY the subscription tier (never tokens/credentials) and is meant to
 * run from the SessionEnd hook, NOT the per-render statusline. Result is cached
 * to plan-cache.json. Returns the detected plan key or null.
 */
function detectPlan() {
  let tier = '';
  try {
    const r = spawnSync('claude', ['auth', 'status', '--json'], {
      encoding: 'utf8',
      timeout: 5000,
      shell: true, // resolves claude.cmd on Windows
    });
    // Read ONLY the subscription field — never email/orgName, which could
    // otherwise produce false "pro"/"max" matches.
    try {
      const j = JSON.parse(r.stdout || '{}');
      tier = j.subscriptionType || j.subscription || j.tier || '';
    } catch {
      tier = ''; // unparseable → no detection this round
    }
  } catch {
    return readCachedPlan(); // keep whatever we had
  }
  const plan = tierToPlan(tier);
  if (plan) {
    try {
      const dir = path.dirname(planCachePath());
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        planCachePath(),
        JSON.stringify({ plan, detectedAt: new Date().toISOString() })
      );
    } catch { /* telemetry must never throw */ }
  }
  return plan;
}

/** Read the cached auto-detected plan key, or null if absent/unreadable. */
function readCachedPlan() {
  try {
    const j = JSON.parse(fs.readFileSync(planCachePath(), 'utf8'));
    return PLANS[j.plan] ? j.plan : null;
  } catch {
    return null;
  }
}

/** True when the cached plan is missing or older than the TTL. */
function planCacheStale(now = Date.now()) {
  try {
    const j = JSON.parse(fs.readFileSync(planCachePath(), 'utf8'));
    const at = j.detectedAt ? new Date(j.detectedAt).getTime() : 0;
    return !(now - at < PLAN_CACHE_TTL_MS);
  } catch {
    return true;
  }
}

/**
 * Resolve the active caps. Priority:
 *   1. explicit env caps / TOKEN_WATCH_PLAN  (user override)
 *   2. auto-detected plan from plan-cache.json (no user action needed)
 *   3. no cap (raw rolling totals shown)
 * Env caps (SESSION_CAP/WEEKLY_CAP) always win for their field.
 */
/**
 * Pure cap-resolution logic (no I/O), so it's deterministically testable.
 * @param {object} o
 * @param {string} [o.envPlan]     value of TOKEN_WATCH_PLAN
 * @param {number} [o.envSession]  parsed TOKEN_WATCH_SESSION_CAP
 * @param {number} [o.envWeekly]   parsed TOKEN_WATCH_WEEKLY_CAP
 * @param {string|null} [o.cachedPlan] auto-detected plan key (or null)
 */
function computeCaps({ envPlan, envSession, envWeekly, cachedPlan } = {}) {
  const envKey = String(envPlan || '').toLowerCase();
  const planKey = PLANS[envKey] ? envKey : (PLANS[cachedPlan] ? cachedPlan : null);
  const preset = planKey ? PLANS[planKey] : null;

  const session5h = Number.isFinite(envSession) && envSession > 0
    ? envSession
    : (preset ? preset.session5h : 0);
  const weekly = Number.isFinite(envWeekly) && envWeekly > 0
    ? envWeekly
    : (preset ? preset.weekly : 0);

  return { plan: planKey, session5h, weekly };
}

/** Resolve caps from the live environment + auto-detected plan cache. */
function resolveCaps() {
  return computeCaps({
    envPlan: process.env.TOKEN_WATCH_PLAN,
    envSession: parseInt(process.env.TOKEN_WATCH_SESSION_CAP, 10),
    envWeekly: parseInt(process.env.TOKEN_WATCH_WEEKLY_CAP, 10),
    cachedPlan: readCachedPlan(),
  });
}

/**
 * Single pass over transcripts to total tokens in BOTH rolling windows.
 * Returns { session5h, weekly } in tokens.
 *
 * The metric is input + output + cacheWrite, EXCLUDING cache_read: cache reads
 * are the model re-reading its own resident context every turn and dwarf real
 * consumption by 10-50x, which would make any subscription gauge meaningless.
 * input+output+cacheWrite is a far better proxy for "new work" against the
 * rolling caps.
 *
 * Transcripts are sorted newest-first by mtime, so we can stop scanning files
 * once a file is older than the widest (weekly) window.
 */
function rollingUsage(now = Date.now()) {
  const sessionCutoff = now - SESSION_WINDOW_MS;
  const weeklyCutoff = now - WEEKLY_WINDOW_MS;
  let session5h = 0;
  let weekly = 0;

  for (const f of allTranscripts()) {
    // Files are newest-first; once a file's mtime predates the weekly window,
    // every remaining file is older too. (A record can be older than its file
    // mtime but never newer, so this is safe for the upper bound.)
    if (f.mtime < weeklyCutoff) break;

    for (const r of readTranscript(f.file)) {
      const ts = r.ts ? new Date(r.ts).getTime() : f.mtime;
      if (ts < weeklyCutoff) continue;
      const toks = r.input + r.output + r.cacheWrite; // exclude cache_read

      weekly += toks;
      if (ts >= sessionCutoff) session5h += toks;
    }
  }

  return { session5h, weekly };
}

module.exports = {
  PLANS,
  SESSION_WINDOW_MS,
  WEEKLY_WINDOW_MS,
  computeCaps,
  resolveCaps,
  rollingUsage,
  detectPlan,
  readCachedPlan,
  planCacheStale,
  planCachePath,
  tierToPlan,
};
