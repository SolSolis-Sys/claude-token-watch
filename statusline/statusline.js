#!/usr/bin/env node
'use strict';

/**
 * token-watch statusline for Claude Code.
 *
 * Claude Code pipes a JSON object on stdin describing the current session.
 * We render a compact, single-line gauge:
 *
 *   ◈ Sonnet 4.6  ▕████░░░░░░▏ 38% ctx · 76k/200k  ·  $0.42  ·  5h 1.2M
 *
 * Live context size is derived from the LAST assistant message in the
 * transcript (input + cache_read + cache_creation), which is exactly the
 * number of tokens that were resident in the model's context for that call.
 * This is robust to schema churn in the statusline payload itself.
 *
 * Environment overrides:
 *   TOKEN_WATCH_CONTEXT_WINDOW  — override context window size in tokens
 *   TOKEN_WATCH_SESSION_CAP     — token cap for 5h rolling window (optional)
 */

const fs = require('fs');
const path = require('path');
const { colors, humanNumber, usd, bar, ratioColor } = require('../lib/format');
const { contextWindow } = require('../lib/pricing');
const { allTranscripts, readTranscript, aggregate } = require('../lib/transcript');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function modelLabel(input) {
  const m = input.model || {};
  const name = m.display_name || m.id || input.model_id || 'Claude';
  return String(name).replace(/^claude-/i, '').replace(/-/g, ' ');
}

/** Last assistant usage from the transcript -> live context token count. */
function liveContext(transcriptPath) {
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

function sessionCost(input) {
  // Prefer Claude Code's own estimate when present.
  if (input.cost && typeof input.cost.total_cost_usd === 'number') {
    return input.cost.total_cost_usd;
  }
  return null;
}

/**
 * Aggregate total tokens across all transcripts in the last `windowMs` ms.
 * Used to compute the rolling 5h subscription window for the statusline.
 */
function rollingTokens(windowMs) {
  const cutoff = Date.now() - windowMs;
  let total = 0;
  for (const f of allTranscripts()) {
    if (f.mtime < cutoff) continue; // transcripts sorted newest-first; could break early
    const records = readTranscript(f.file);
    for (const r of records) {
      // Use timestamp from record when available, else file mtime as proxy
      const ts = r.ts ? new Date(r.ts).getTime() : f.mtime;
      if (ts < cutoff) continue;
      total += r.input + r.output + r.cacheRead + r.cacheWrite;
    }
  }
  return total;
}

function main() {
  let input = {};
  try { input = JSON.parse(readStdin() || '{}'); } catch { input = {}; }

  const transcriptPath = input.transcript_path || (input.transcript && input.transcript.path);
  const live = liveContext(transcriptPath);
  const modelId = (live && live.model) || (input.model && input.model.id) || '';
  const label = modelLabel(input);

  const parts = [];
  parts.push(colors.cyan('◈ ' + colors.bold(label)));

  if (live && live.ctx != null) {
    const win = contextWindow(modelId);
    const pct = live.ctx / win;
    const col = ratioColor(pct);
    const gauge = '▕' + col(bar(pct, 10)) + '▏';
    parts.push(
      gauge +
        ' ' +
        col(Math.round(pct * 100) + '%') +
        ' ' +
        colors.dim('ctx') +
        ' ' +
        colors.gray(humanNumber(live.ctx) + '/' + humanNumber(win))
    );
  }

  const cost = sessionCost(input);
  if (cost != null) parts.push(colors.green(usd(cost)));

  // Rolling 5h session window (subscription usage indicator)
  const sessionCap = parseInt(process.env.TOKEN_WATCH_SESSION_CAP, 10);
  const sessionToks = rollingTokens(5 * 3600 * 1000);
  if (sessionToks > 0) {
    let sessionPart = colors.dim('5h ') + colors.gray(humanNumber(sessionToks));
    if (!isNaN(sessionCap) && sessionCap > 0) {
      const pct = Math.round((sessionToks / sessionCap) * 100);
      const col = ratioColor(sessionToks / sessionCap);
      sessionPart = colors.dim('5h ') + col(humanNumber(sessionToks) + '/' + humanNumber(sessionCap) + ' (' + pct + '%)');
    }
    parts.push(sessionPart);
  }

  process.stdout.write(parts.join(colors.gray('  ·  ')));
}

main();
