'use strict';

/**
 * usage-api.js — Fetch real utilization % from Anthropic's OAuth usage endpoint.
 *
 * This is the same data source that powers the `/usage` command in Claude Code.
 * Endpoint: GET https://api.anthropic.com/api/oauth/usage
 * Auth:     Bearer token from ~/.claude/.credentials.json (claudeAiOauth.accessToken)
 *
 * Response shape (confirmed 2026-06-15):
 *   {
 *     "five_hour":  { "utilization": 24.0,  "resets_at": "<ISO>" },
 *     "seven_day":  { "utilization": 60.0,  "resets_at": "<ISO>" },
 *     ...extra_usage, tangelo, etc. (ignored here)
 *   }
 *
 * utilization is a percentage (0–100). We expose it as a fraction (0–1) to
 * match the convention used throughout the codebase (bar(), ratioColor(), etc.).
 *
 * Cache: results are cached for CACHE_TTL_MS (60s) in two layers:
 *   L1 — in-memory (`_cache`), fast path within a single process lifetime.
 *   L2 — on-disk (~/.claude/token-watch/usage-cache.json), because the
 *        statusline is re-spawned as a BRAND NEW Node process on every
 *        render. Without a disk-persisted cache, the in-memory TTL never
 *        survives a render cycle, forcing a fresh GET every time — which the
 *        API rate-limits (HTTP 429), silently degrading to the misleading
 *        heuristic fallback. The disk cache is the actual fix for this.
 *
 *        On a failed fetch (429, network, timeout), a stale disk cache (even
 *        expired) is still preferred over giving up: real-but-stale data is
 *        more trustworthy than the heuristic estimate. null is only returned
 *        when no disk cache exists at all.
 *
 * Root cause of the "frozen gauge" bug (S101 follow-up):
 *   The statusline is re-spawned on every render, often several times per
 *   second while Claude Code is streaming. Every one of those processes
 *   independently checks "is the disk cache stale?" and, if so, fires its
 *   OWN HTTP GET — with no coordination between processes. Near a TTL
 *   boundary this means a burst of concurrent requests, which is exactly
 *   what trips the 429. Worse, every subsequent render retried at the same
 *   fixed 60s cadence with no backoff, so a sustained 429 (or a server-side
 *   penalty window longer than 60s) caused an indefinite retry-fail loop:
 *   the gauge silently stuck on the last successfully fetched value forever,
 *   with no visible error and no growing delay to let the rate limit clear.
 *   Two fixes address this:
 *     1. A persisted failure backoff (`failCount` + `nextRetryAt` in the
 *        disk cache) makes repeated failures wait longer before retrying,
 *        so we stop hammering the API and let the 429 window clear.
 *     2. An atomic disk write (temp file + rename) prevents concurrent
 *        statusline processes from corrupting/truncating the cache file
 *        when writes race each other.
 *
 * Security:
 *   - The access token is NEVER logged or written to any file (disk cache
 *     only ever contains parsed percentages/timestamps, never the token).
 *   - TLS is verified by default (rejectUnauthorized: true — secure-by-default).
 *   - On TLS chain failure (e.g. Windows / corporate proxy), a one-time stderr
 *     warning is emitted and the request is retried without TLS verification,
 *     UNLESS TOKEN_WATCH_TLS_STRICT=1 is set (in which case: no fallback, null).
 *     A successful insecure fallback persists `tlsInsecureOk: true` to the
 *     disk cache so future fetches (new processes) skip the doomed strict
 *     attempt — unless TOKEN_WATCH_TLS_STRICT=1, which always wins.
 *   - On any other error (network, timeout, auth), the module returns
 *     cached/stale data if available, else null (caller falls back to
 *     heuristic mode).
 *
 * WINDOWS NOTE: Node.js on Windows may fail to verify the Anthropic TLS chain
 * (UNABLE_TO_VERIFY_LEAF_SIGNATURE) because Node's bundled OpenSSL does not use
 * the OS certificate store. The automatic fallback described above handles this
 * transparently. Set TOKEN_WATCH_TLS_STRICT=1 to disable the fallback and
 * enforce strict TLS (useful for audited environments).
 */

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const USAGE_HOST = 'api.anthropic.com';
const USAGE_PATH = '/api/oauth/usage';
const CACHE_TTL_MS = 60 * 1000;

// Backoff after repeated fetch failures (e.g. sustained 429s). Without this,
// every statusline render (re-spawned process) retries at the same fixed
// 60s cadence, which can itself be the cause of a persistent 429 when
// multiple renders overlap, and never lets the rate-limit window clear.
const BACKOFF_BASE_MS = 60 * 1000;
const BACKOFF_MAX_MS = 30 * 60 * 1000; // cap at 30 minutes
const BACKOFF_MAX_FAILCOUNT = 10; // 2^10 * base would overflow the cap anyway

const CACHE_DIR = path.join(os.homedir(), '.claude', 'token-watch');
const CACHE_FILE = path.join(CACHE_DIR, 'usage-cache.json');

/** In-memory cache: { data, fetchedAt, tlsInsecureOk } or null */
let _cache = null;

/** Whether the TLS fallback warning has already been printed this process */
let _tlsWarned = false;

/**
 * Read the persistent disk cache. Returns { data, fetchedAt, tlsInsecureOk }
 * or null if absent/corrupt. Never throws.
 */
function _readDiskCache() {
  let raw;
  try {
    raw = fs.readFileSync(CACHE_FILE, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.fetchedAt !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Write the persistent disk cache. The token is NEVER part of `entry`
 * (only parsed percentages/timestamps + the tlsInsecureOk flag). Best-effort:
 * failures (e.g. read-only filesystem) are swallowed silently.
 *
 * Written atomically (write to a per-process temp file, then rename) so that
 * concurrent statusline processes — re-spawned on every render — can never
 * observe or persist a half-written/truncated file. `fs.renameSync` is
 * atomic on both POSIX and Windows (NTFS) for same-volume renames, so a
 * reader always sees either the old complete file or the new complete file,
 * never a partial one.
 */
function _writeDiskCache(entry) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const tmpFile = CACHE_FILE + '.tmp-' + process.pid + '-' + Date.now();
    fs.writeFileSync(tmpFile, JSON.stringify(entry));
    fs.renameSync(tmpFile, CACHE_FILE);
  } catch {
    // best-effort cache — ignore write failures
  }
}

/**
 * Compute the next allowed retry time after a failed fetch, using
 * exponential backoff seeded from the disk cache's `failCount`. This is
 * what stops concurrent re-spawned statusline processes from retrying a
 * doomed request every 60s forever once the API starts rejecting us — each
 * failure pushes the next attempt further out, until a success resets it.
 *
 * @param {number} failCount - consecutive failures so far (0 if none/unknown)
 * @returns {number} delay in ms before the next fetch should be attempted
 */
function _backoffDelayMs(failCount) {
  const n = Math.min(Math.max(failCount, 0), BACKOFF_MAX_FAILCOUNT);
  return Math.min(BACKOFF_BASE_MS * Math.pow(2, n), BACKOFF_MAX_MS);
}

/** TLS error codes that justify a fallback (certificate chain issues only) */
function _isTlsChainError(code) {
  if (!code) return false;
  return (
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN'       ||
    code.startsWith('UNABLE_TO_VERIFY')        ||
    code.startsWith('CERT_')
  );
}

/**
 * Read the OAuth access token from ~/.claude/.credentials.json.
 * Returns null if the file is missing, unreadable, token absent, or expired.
 * NEVER logs the token value.
 */
function readAccessToken() {
  const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
  let raw;
  try {
    raw = fs.readFileSync(credPath, 'utf8');
  } catch {
    return null; // file absent or unreadable
  }
  let creds;
  try {
    creds = JSON.parse(raw);
  } catch {
    return null; // corrupt JSON
  }
  const oauth = creds && creds.claudeAiOauth;
  if (!oauth || !oauth.accessToken) return null;

  // Check expiry — expiresAt is epoch-ms
  if (oauth.expiresAt && typeof oauth.expiresAt === 'number') {
    if (Date.now() >= oauth.expiresAt) return null; // expired
  }
  return oauth.accessToken;
}

/**
 * Low-level HTTPS request helper.
 *
 * @param {string} token  - Bearer token (never logged).
 * @param {boolean} rejectUnauthorized - Whether to verify the TLS chain.
 * @returns {Promise<{data: object}|{error: string}>}
 *   Resolves to {data} on HTTP 200 + valid JSON, or {error: <code>} otherwise.
 *   The error code is the Node TLS error code on socket errors, or a synthetic
 *   string ('HTTP_<status>', 'PARSE_ERROR', 'TIMEOUT', 'NETWORK') for other cases.
 */
function doRequest(token, rejectUnauthorized) {
  return new Promise((resolve) => {
    const options = {
      hostname: USAGE_HOST,
      path: USAGE_PATH,
      method: 'GET',
      rejectUnauthorized,
      headers: {
        'Authorization': 'Bearer ' + token,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'token-watch/0.2.1',
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          resolve({ error: 'HTTP_' + res.statusCode });
          return;
        }
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          resolve({ error: 'PARSE_ERROR' });
          return;
        }
        resolve({ data: parsed });
      });
    });

    req.on('error', (err) => {
      resolve({ error: err.code || 'NETWORK' });
    });
    req.setTimeout(4000, () => {
      req.destroy();
      resolve({ error: 'TIMEOUT' });
    });
    req.end();
  });
}

/**
 * Parse the raw API response object into the public shape.
 * Returns null if required fields are missing.
 *
 * @param {object} parsed
 * @returns {{session5hPct, weekly7dPct, resetsSession, resetsWeekly}|null}
 */
function _parseUsage(parsed) {
  const fh = parsed.five_hour;
  const sd = parsed.seven_day;
  if (!fh || !sd) return null;
  return {
    session5hPct: typeof fh.utilization === 'number' ? fh.utilization / 100 : null,
    weekly7dPct: typeof sd.utilization === 'number' ? sd.utilization / 100 : null,
    resetsSession: fh.resets_at || null,
    resetsWeekly: sd.resets_at || null,
  };
}

/**
 * Fetch real utilization from the API.
 *
 * Strategy — secure-by-default with graceful TLS fallback:
 *   1. Attempt strict TLS (rejectUnauthorized: true) — UNLESS a previous
 *      process already recorded `tlsInsecureOk: true` in the disk cache AND
 *      TOKEN_WATCH_TLS_STRICT is not '1', in which case skip straight to the
 *      non-strict attempt (the strict leg is known-doomed on this machine).
 *   2. If the error is a certificate chain failure AND TOKEN_WATCH_TLS_STRICT
 *      is not '1': emit a one-time stderr warning, then retry without TLS
 *      verification (rejectUnauthorized: false). On success, persist
 *      `tlsInsecureOk: true` to the disk cache for future processes.
 *   3. If TOKEN_WATCH_TLS_STRICT=1: no fallback, ever → resolve null.
 *   4. Any other error (network, timeout, auth, parse): resolve null, no retry.
 *
 * Returns a Promise resolving to:
 *   { session5hPct: <0-1>, weekly7dPct: <0-1>, resetsSession: <ISO|null>, resetsWeekly: <ISO|null> }
 * or null on any unrecoverable error.
 *
 * The access token is NEVER logged.
 */
async function fetchUsage() {
  _lastFetchTlsInsecureOk = false;

  const token = readAccessToken();
  if (!token) return null;

  const strictMode = process.env.TOKEN_WATCH_TLS_STRICT === '1';
  const diskHint = !strictMode ? _readDiskCache() : null;
  const skipStrict = !strictMode && diskHint && diskHint.tlsInsecureOk === true;

  if (!skipStrict) {
    // First attempt: strict TLS (secure-by-default).
    const first = await doRequest(token, true);

    if (first.data) return _parseUsage(first.data);

    if (!_isTlsChainError(first.error)) {
      // Non-TLS error (HTTP error, network, timeout, parse): give up.
      return null;
    }

    if (strictMode) {
      // Strict mode enforced — no fallback, ever.
      return null;
    }

    if (!_tlsWarned) {
      _tlsWarned = true;
      process.stderr.write(
        '[token-watch] Chaîne TLS api.anthropic.com non vérifiable par Node' +
        ' — fallback TLS non vérifié.' +
        ' TOKEN_WATCH_TLS_STRICT=1 pour désactiver ce fallback.\n'
      );
    }
  }

  // Non-strict attempt (either following a TLS chain failure above, or
  // skipped straight here because a prior process proved strict is doomed).
  const second = await doRequest(token, false);
  if (second.data) {
    const parsed = _parseUsage(second.data);
    if (parsed) _lastFetchTlsInsecureOk = true;
    return parsed;
  }
  return null;
}

/** Set by fetchUsage() when the most recent successful fetch required the
 * non-strict TLS fallback. Read by getUsage() when persisting the disk
 * cache. Reset on each fetchUsage() call via the strict path (implicitly,
 * since it's only read immediately after a fetchUsage() call). */
let _lastFetchTlsInsecureOk = false;

/**
 * Get cached or fresh usage data.
 *
 * Two-layer cache (see module header for the why):
 *   L1 in-memory  — fast path, but dies with the process (statusline is
 *                   re-spawned fresh on every render, so this almost never
 *                   hits in practice).
 *   L2 on-disk    — survives across process spawns; this is what actually
 *                   prevents hammering the API and tripping 429s.
 *
 * On a failed fetch (null from fetchUsage()), a stale disk cache is still
 * preferred over null: real-but-stale data beats the heuristic fallback.
 * null is only returned when fetchUsage() fails AND no disk cache exists.
 *
 * Returns the same shape as fetchUsage(), or null if unavailable.
 */
async function getUsage() {
  const now = Date.now();

  // L1 — in-memory, fresh.
  if (_cache && (now - _cache.fetchedAt) < CACHE_TTL_MS) {
    return _cache.data;
  }

  // L2 — on-disk, fresh. Avoids an HTTP call entirely.
  const disk = _readDiskCache();
  if (disk && (now - disk.fetchedAt) < CACHE_TTL_MS) {
    _cache = { data: disk.data, fetchedAt: disk.fetchedAt };
    return disk.data;
  }

  // Backoff gate: if a previous process recorded repeated failures, respect
  // the computed `nextRetryAt` instead of retrying every render. This is
  // what prevents a burst of concurrent re-spawned statusline processes
  // from hammering the API (and re-triggering the 429) every 60s forever.
  // Skipping the fetch here still falls through to the stale-data path
  // below, so the gauge keeps showing the last known-good value while we
  // wait out the backoff — it just won't keep retrying pointlessly.
  const failCount = (disk && typeof disk.failCount === 'number') ? disk.failCount : 0;
  const nextRetryAt = (disk && typeof disk.nextRetryAt === 'number') ? disk.nextRetryAt : 0;
  const backoffActive = failCount > 0 && now < nextRetryAt;

  const data = backoffActive ? null : await fetchUsage();

  if (data) {
    // Fresh successful fetch: persist to both cache layers, reset backoff.
    const entry = {
      data,
      fetchedAt: now,
      tlsInsecureOk: _lastFetchTlsInsecureOk,
      failCount: 0,
      nextRetryAt: 0,
    };
    _cache = entry;
    _writeDiskCache(entry);
    return data;
  }

  // Fetch failed (429, network, timeout, no token, ...) or was skipped due
  // to an active backoff window. Record/advance the backoff so the NEXT
  // process (next render) waits longer before retrying, instead of
  // hammering the API again immediately.
  if (!backoffActive) {
    const newFailCount = failCount + 1;
    const backoffEntry = {
      data: disk && disk.data ? disk.data : null,
      fetchedAt: disk ? disk.fetchedAt : now,
      tlsInsecureOk: disk ? disk.tlsInsecureOk : false,
      failCount: newFailCount,
      nextRetryAt: now + _backoffDelayMs(newFailCount),
    };
    _writeDiskCache(backoffEntry);
  }

  // Prefer a stale disk cache — even expired — over giving up to the
  // heuristic fallback: real-but-stale data beats the heuristic estimate.
  if (disk && disk.data) {
    _cache = { data: disk.data, fetchedAt: disk.fetchedAt };
    return disk.data;
  }

  _cache = { data: null, fetchedAt: now };
  return null;
}

/** Expose for tests: reset the in-memory cache. */
function _resetCache() {
  _cache = null;
}

module.exports = {
  getUsage,
  fetchUsage,
  readAccessToken,
  _resetCache,
  _backoffDelayMs,
  CACHE_TTL_MS,
  CACHE_FILE,
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
};
