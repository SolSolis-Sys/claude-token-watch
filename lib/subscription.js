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

const { allTranscripts, readTranscript } = require('./transcript');

const HOUR = 3600 * 1000;
const SESSION_WINDOW_MS = 5 * HOUR;
const WEEKLY_WINDOW_MS = 7 * 24 * HOUR;

/**
 * Heuristic token-equivalent caps per plan. These are NOT official Anthropic
 * numbers; they approximate observed ceilings and scale with the plan tier
 * (Max 5x ≈ 5× Pro, Max 20x ≈ 20× Pro). Tune via env overrides.
 */
const PLANS = {
  pro:   { session5h:  1_500_000, weekly:  15_000_000 },
  max5:  { session5h:  7_500_000, weekly:  75_000_000 },
  max20: { session5h: 30_000_000, weekly: 300_000_000 },
};

/**
 * Resolve the active caps from env. Env caps take precedence over the plan
 * preset; either field may be 0/NaN to mean "no cap" (show raw total).
 */
function resolveCaps() {
  const planKey = String(process.env.TOKEN_WATCH_PLAN || '').toLowerCase();
  const preset = PLANS[planKey] || null;

  const envSession = parseInt(process.env.TOKEN_WATCH_SESSION_CAP, 10);
  const envWeekly = parseInt(process.env.TOKEN_WATCH_WEEKLY_CAP, 10);

  const session5h = !isNaN(envSession) && envSession > 0
    ? envSession
    : (preset ? preset.session5h : 0);
  const weekly = !isNaN(envWeekly) && envWeekly > 0
    ? envWeekly
    : (preset ? preset.weekly : 0);

  return { plan: preset ? planKey : null, session5h, weekly };
}

/**
 * Single pass over transcripts to total tokens in BOTH rolling windows.
 * Returns { session5h, weekly } in tokens (input+output+cacheRead+cacheWrite).
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
      const toks = r.input + r.output + r.cacheRead + r.cacheWrite;
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
  resolveCaps,
  rollingUsage,
};
