'use strict';

/**
 * cache-ttl.js — Compute Anthropic prompt cache TTL state from a transcript.
 *
 * Anthropic cache TTLs (confirmed):
 *   ephemeral_5m  → 300s (5 minutes)
 *   ephemeral_1h  → 3600s (1 hour)
 *   Cache TTL resets on every hit (cache_read_input_tokens > 0).
 *
 * Algorithm:
 *   1. Read the transcript backward.
 *   2. Find the LAST assistant message with any cache event.
 *   3. Determine the TTL (1h or 5m) and the event timestamp.
 *   4. Compute secondsLeft = TTL - elapsed.
 *   5. Return { warm, secondsLeft, pct, type } or null.
 *
 * Errors: all try/catch — never crashes the statusline.
 */

const fs   = require('fs');
const path = require('path');

const TTL_5M = 300;
const TTL_1H = 3600;

// Safety caps to prevent hanging on huge transcripts.
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_LINES_SCAN = 10_000;            // ~1 MB of JSONL at ~100 bytes/line

/**
 * Extract the cache event from a parsed assistant JSONL message's usage block.
 * Returns { cacheRead, write5m, write1h } counts.
 */
function extractCacheFields(usage) {
  if (!usage) return { cacheRead: 0, write5m: 0, write1h: 0 };

  const cacheRead = usage.cache_read_input_tokens || 0;

  // Nested cache_creation object (newer schema)
  let write5m = 0;
  let write1h = 0;
  if (usage.cache_creation && typeof usage.cache_creation === 'object') {
    write5m = usage.cache_creation.ephemeral_5m_input_tokens || 0;
    write1h = usage.cache_creation.ephemeral_1h_input_tokens || 0;
  }

  // Flat fallback (older schema — treat as 5m write)
  const flatWrite = usage.cache_creation_input_tokens || 0;
  if (flatWrite > 0 && write5m === 0 && write1h === 0) {
    write5m = flatWrite;
  }

  return { cacheRead, write5m, write1h };
}

/**
 * Compute cache TTL status from a transcript JSONL file.
 *
 * @param {string|null} transcriptPath  absolute path to *.jsonl transcript
 * @returns {{ warm: boolean, secondsLeft: number, pct: number, type: '5m'|'1h' } | null}
 */
function cacheStatus(transcriptPath) {
  if (!transcriptPath) return null;

  try {
    if (!fs.existsSync(transcriptPath)) return null;

    // Reject oversized files before reading into memory.
    try {
      const stat = fs.statSync(transcriptPath);
      if (stat.size > MAX_FILE_BYTES) return null;
    } catch {
      return null;
    }

    let raw;
    try {
      raw = fs.readFileSync(transcriptPath, 'utf8');
    } catch {
      return null;
    }

    const lines = raw.split('\n');

    // Scan backward: find the last assistant message with a cache event.
    // Also track the last 1h write so we know the TTL if the last event is a hit.
    let lastCacheEvent = null;  // { ts, cacheRead, write5m, write1h }
    let lastWriteType  = '5m'; // track last explicit write type for hit-only case
    let scanned        = 0;

    for (let i = lines.length - 1; i >= 0; i--) {
      if (++scanned > MAX_LINES_SCAN) break;
      const s = lines[i].trim();
      if (!s) continue;
      let j;
      try { j = JSON.parse(s); } catch { continue; }
      if (j.type !== 'assistant') continue;

      const usage = j.message && j.message.usage;
      if (!usage) continue;

      const { cacheRead, write5m, write1h } = extractCacheFields(usage);

      if (cacheRead > 0 || write5m > 0 || write1h > 0) {
        // Get timestamp
        let ts = null;
        if (j.timestamp) {
          ts = new Date(j.timestamp).getTime() / 1000;
          if (isNaN(ts)) ts = null;
        }
        if (ts === null) {
          try {
            ts = fs.statSync(transcriptPath).mtime.getTime() / 1000;
          } catch {
            ts = Date.now() / 1000;
          }
        }

        lastCacheEvent = { ts, cacheRead, write5m, write1h };

        // Track write type for this event
        if (write1h > 0) lastWriteType = '1h';
        else if (write5m > 0) lastWriteType = '5m';
        // If pure read hit, keep lastWriteType from a prior scan pass below

        break; // found the most recent event
      }
    }

    if (!lastCacheEvent) return null;

    // Determine TTL: 1h if this event or a recent write was 1h
    let ttl = TTL_5M;
    let type = '5m';

    if (lastCacheEvent.write1h > 0) {
      ttl  = TTL_1H;
      type = '1h';
    } else if (lastCacheEvent.write5m > 0) {
      ttl  = TTL_5M;
      type = '5m';
    } else {
      // Pure hit — scan backward further to find the write that created this cache
      let hitScan = 0;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (++hitScan > MAX_LINES_SCAN) break;
        const s = lines[i].trim();
        if (!s) continue;
        let j;
        try { j = JSON.parse(s); } catch { continue; }
        if (j.type !== 'assistant') continue;
        const usage = j.message && j.message.usage;
        if (!usage) continue;
        const { write5m: w5, write1h: w1 } = extractCacheFields(usage);
        if (w1 > 0) { ttl = TTL_1H; type = '1h'; break; }
        if (w5 > 0) { ttl = TTL_5M; type = '5m'; break; }
      }
    }

    const nowSec     = Date.now() / 1000;
    const elapsed    = nowSec - lastCacheEvent.ts;
    const secondsLeft = Math.max(0, ttl - elapsed);
    const warm       = secondsLeft > 0;
    const pct        = secondsLeft / ttl;

    return { warm, secondsLeft, pct, type };

  } catch {
    return null;
  }
}

module.exports = { cacheStatus };
