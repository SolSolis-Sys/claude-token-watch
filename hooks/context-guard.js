#!/usr/bin/env node
'use strict';

/**
 * Stop hook — suggests /compact when the live context window gets large.
 *
 * Reads the hook JSON on stdin, locates the transcript, computes the
 * resident context size from the last assistant message, and — if the
 * fill ratio crosses the threshold — surfaces a one-line system message.
 *
 * Threshold is configurable via TOKEN_WATCH_COMPACT_PCT (0..100, default 80).
 * The hook never blocks; it only informs.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { contextWindow } = require('../lib/pricing');
const { humanNumber } = require('../lib/format');

const CONFIG_FILE = path.join(os.homedir(), '.claude', 'token-watch', 'config.json');

/** Read a numeric key from ~/.claude/token-watch/config.json. Returns NaN on failure. */
function readConfigValue(key) {
  try {
    const raw  = fs.readFileSync(CONFIG_FILE, 'utf8');
    const cfg  = JSON.parse(raw);
    const val  = cfg && cfg[key];
    return (typeof val === 'number' && !isNaN(val)) ? val : NaN;
  } catch {
    return NaN;
  }
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

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
    const ctx =
      (u.input_tokens || 0) +
      (u.cache_read_input_tokens || 0) +
      (u.cache_creation_input_tokens ||
        ((u.cache_creation &&
          ((u.cache_creation.ephemeral_5m_input_tokens || 0) +
            (u.cache_creation.ephemeral_1h_input_tokens || 0))) || 0));
    return { ctx, model: j.message.model };
  }
  return null;
}

function main() {
  let input = {};
  try { input = JSON.parse(readStdin() || '{}'); } catch { input = {}; }

  // Priority: env var > config file > built-in default (80)
  const envPct    = Number(process.env.TOKEN_WATCH_COMPACT_PCT);
  const rawPct    = !isNaN(envPct) ? envPct : (readConfigValue('compact-pct') || 80);
  const threshold = Math.max(1, Math.min(99, rawPct)) / 100;
  const transcriptPath = input.transcript_path;
  const live = lastContext(transcriptPath);
  if (!live || live.ctx == null) { process.exit(0); }

  const win = contextWindow(live.model);
  const pct = live.ctx / win;
  if (pct < threshold) { process.exit(0); }

  const msg =
    `⚠ token-watch: context at ${Math.round(pct * 100)}% ` +
    `(${humanNumber(live.ctx)}/${humanNumber(win)}). ` +
    `Consider running /compact to free up the window.`;

  // Surface to the user without blocking. systemMessage is the supported,
  // forward-compatible field; unknown fields are ignored by older CC.
  process.stdout.write(JSON.stringify({ systemMessage: msg }));
  process.exit(0);
}

main();
