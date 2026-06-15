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
 * Cache: results are stored in memory with a 60-second TTL to avoid hammering
 * the API on each statusline render. File-level module cache is sufficient for
 * a single Node process.
 *
 * Security:
 *   - The access token is NEVER logged or written to any file.
 *   - TLS is verified by default (rejectUnauthorized: true — secure-by-default).
 *   - On TLS chain failure (e.g. Windows / corporate proxy), a one-time stderr
 *     warning is emitted and the request is retried without TLS verification,
 *     UNLESS TOKEN_WATCH_TLS_STRICT=1 is set (in which case: no fallback, null).
 *   - On any other error (network, timeout, auth), the module returns null and
 *     the caller falls back to heuristic mode — no fallback.
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

/** In-memory cache: { data, fetchedAt } or null */
let _cache = null;

/** Whether the TLS fallback warning has already been printed this process */
let _tlsWarned = false;

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
 *   1. Attempt strict TLS (rejectUnauthorized: true).
 *   2. If the error is a certificate chain failure AND TOKEN_WATCH_TLS_STRICT
 *      is not '1': emit a one-time stderr warning, then retry without TLS
 *      verification (rejectUnauthorized: false).
 *   3. If TOKEN_WATCH_TLS_STRICT=1: no fallback → resolve null.
 *   4. Any other error (network, timeout, auth, parse): resolve null, no retry.
 *
 * Returns a Promise resolving to:
 *   { session5hPct: <0-1>, weekly7dPct: <0-1>, resetsSession: <ISO|null>, resetsWeekly: <ISO|null> }
 * or null on any unrecoverable error.
 *
 * The access token is NEVER logged.
 */
async function fetchUsage() {
  const token = readAccessToken();
  if (!token) return null;

  // First attempt: strict TLS (secure-by-default).
  const first = await doRequest(token, true);

  if (first.data) return _parseUsage(first.data);

  // If it was a TLS chain error and strict mode is not forced, try without
  // certificate verification — but warn the user exactly once per process.
  if (_isTlsChainError(first.error)) {
    if (process.env.TOKEN_WATCH_TLS_STRICT === '1') {
      // Strict mode enforced — no fallback.
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

    const second = await doRequest(token, false);
    if (second.data) return _parseUsage(second.data);
    return null;
  }

  // Any other error (HTTP error, network, timeout, parse): give up.
  return null;
}

/**
 * Get cached or fresh usage data.
 *
 * Returns the same shape as fetchUsage(), or null if unavailable.
 * Caches for CACHE_TTL_MS to avoid hammering the API on every statusline render.
 */
async function getUsage() {
  const now = Date.now();
  if (_cache && (now - _cache.fetchedAt) < CACHE_TTL_MS) {
    return _cache.data;
  }
  const data = await fetchUsage();
  _cache = { data, fetchedAt: now };
  return data;
}

/** Expose for tests: reset the in-memory cache. */
function _resetCache() {
  _cache = null;
}

module.exports = { getUsage, fetchUsage, readAccessToken, _resetCache, CACHE_TTL_MS };
