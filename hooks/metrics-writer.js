#!/usr/bin/env node
'use strict';

/**
 * Stop + PostToolUse hook — writes a live metrics snapshot to
 * ~/.claude/token-watch/metrics.json after every tool use and at session stop.
 *
 * This file is the source of truth read by claude-conductor for the
 * token-watch / conductor synergie (v0.3.3).
 *
 * Output schema:
 *   {
 *     "ts":             <epoch-ms>,
 *     "context_pct":    <0-1 | null>,
 *     "context_tokens": <int | null>,
 *     "context_window": <int | null>,
 *     "model":          <string | null>,
 *     "quota_5h_pct":   <0-1 | null>,
 *     "cost_usd":       <number | null>,
 *     "alert":          <boolean>
 *   }
 *
 * alert = true when context_pct >= 0.90 OR quota_5h_pct >= 0.90.
 *
 * Write strategy: atomic temp-file + rename (same pattern as usage-api.js)
 * so concurrent hook invocations never produce a partial/corrupt file.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { contextWindow } = require('../lib/pricing');
const { readTranscript, aggregate } = require('../lib/transcript');

// ── Constants ────────────────────────────────────────────────────────────────

const CACHE_DIR   = path.join(os.homedir(), '.claude', 'token-watch');
const CACHE_FILE  = path.join(CACHE_DIR, 'usage-cache.json');
const METRICS_FILE = path.join(CACHE_DIR, 'metrics.json');

const ALERT_THRESHOLD = 0.90;

// ── Helpers ──────────────────────────────────────────────────────────────────

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

/**
 * Read the on-disk usage cache written by usage-api.js.
 * Returns { data: { session5hPct, ... } } or null.
 */
function readUsageCache() {
  let raw;
  try { raw = fs.readFileSync(CACHE_FILE, 'utf8'); } catch { return null; }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch { return null; }
}

/**
 * Extract context info from the last assistant message in the transcript.
 * Returns { ctx, model } or null.
 * Mirrors the logic in context-guard.js.
 */
function lastContext(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf8'); } catch { return null; }
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const s = lines[i].trim();
    if (!s) continue;
    let j;
    try { j = JSON.parse(s); } catch { continue; }
    if (j.type !== 'assistant' || !j.message || !j.message.usage) continue;
    const u = j.message.usage;
    const cacheCreation =
      (u.cache_creation &&
        ((u.cache_creation.ephemeral_5m_input_tokens || 0) +
         (u.cache_creation.ephemeral_1h_input_tokens || 0))) ||
      u.cache_creation_input_tokens || 0;

    const ctx =
      (u.input_tokens || 0) +
      (u.cache_read_input_tokens || 0) +
      cacheCreation;
    return { ctx, model: j.message.model || null };
  }
  return null;
}

/**
 * Compute total cost for the current session from the transcript.
 * Returns a number or null if transcript is absent/empty.
 */
function sessionCost(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
  const records = readTranscript(transcriptPath);
  if (records.length === 0) return null;
  return aggregate(records).cost;
}

/**
 * Atomic write to METRICS_FILE. Uses a per-process temp file + rename
 * to avoid partial writes when multiple hook invocations race.
 */
function writeMetrics(payload) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const tmp = METRICS_FILE + '.tmp-' + process.pid + '-' + Date.now();
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, METRICS_FILE);
  } catch (err) {
    // best-effort — never fail a hook over telemetry
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  let input = {};
  try { input = JSON.parse(readStdin() || '{}'); } catch { input = {}; }

  const now = Date.now();
  const transcriptPath = input.transcript_path;

  // ── Context from transcript ──────────────────────────────────────────────
  const live        = lastContext(transcriptPath);
  let contextPct    = null;
  let contextTokens = null;
  let contextWin    = null;
  let model         = null;

  if (live) {
    model         = live.model;
    contextTokens = live.ctx;
    contextWin    = contextWindow(model);
    // Guard against a zero window (shouldn't happen, but be safe)
    contextPct    = contextWin > 0 ? live.ctx / contextWin : null;
  }

  // ── Quota from disk cache (written by usage-api.js) ─────────────────────
  let quota5hPct = null;
  const usageCache = readUsageCache();
  if (usageCache && usageCache.data && typeof usageCache.data.session5hPct === 'number') {
    quota5hPct = usageCache.data.session5hPct;
  }

  // ── Session cost from transcript ─────────────────────────────────────────
  const cost = sessionCost(transcriptPath);

  // ── Alert flag ───────────────────────────────────────────────────────────
  const alert =
    (contextPct  !== null && contextPct  >= ALERT_THRESHOLD) ||
    (quota5hPct  !== null && quota5hPct  >= ALERT_THRESHOLD);

  // ── Write metrics ────────────────────────────────────────────────────────
  writeMetrics({
    ts:             now,
    context_pct:    contextPct    !== null ? Number(contextPct.toFixed(4))    : null,
    context_tokens: contextTokens !== null ? Math.round(contextTokens)        : null,
    context_window: contextWin    !== null ? contextWin                       : null,
    model:          model,
    quota_5h_pct:   quota5hPct    !== null ? Number(quota5hPct.toFixed(4))    : null,
    cost_usd:       cost          !== null ? Number(cost.toFixed(6))          : null,
    alert,
  });

  process.exit(0);
}

main();
