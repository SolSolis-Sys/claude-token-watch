#!/usr/bin/env node
'use strict';

/**
 * token-watch statusline for Claude Code.
 *
 * Claude Code pipes a JSON object on stdin describing the current session.
 * We render a compact, single-line gauge:
 *
 *   ◈ Sonnet 4.6  ▕████░░░░░░▏ 38% ctx · 76k/200k  ·  $0.42  ·  5h ▕██░░░▏ 41%  ·  7d ▕█░░░░▏ 18%
 *
 * Live context size is derived from the LAST assistant message in the
 * transcript (input + cache_read + cache_creation), which is exactly the
 * number of tokens that were resident in the model's context for that call.
 * This is robust to schema churn in the statusline payload itself.
 *
 * The 5h / 7d gauges are the subscription rolling windows (see lib/subscription).
 *
 * Environment overrides:
 *   TOKEN_WATCH_CONTEXT_WINDOW  — override context window size in tokens
 *   TOKEN_WATCH_PLAN            — pro | max5 | max20 (selects window caps)
 *   TOKEN_WATCH_SESSION_CAP     — token cap for the 5h window (overrides plan)
 *   TOKEN_WATCH_WEEKLY_CAP      — token cap for the 7d window (overrides plan)
 */

const fs = require('fs');
const path = require('path');
const { colors, humanNumber, usd, bar, ratioColor } = require('../lib/format');
const { contextWindow } = require('../lib/pricing');
const { getUsage } = require('../lib/usage-api');

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
 * Render one rolling-window gauge: "<label> ▕███░░▏ 41%" when a cap is known,
 * else "<label> 1.2M" as a raw total. Returns null when there's nothing to show.
 */
function windowGauge(label, tokens, cap) {
  if (tokens <= 0) return null;
  if (cap > 0) {
    const pct = tokens / cap;
    const col = ratioColor(pct);
    return (
      colors.dim(label + ' ') +
      '▕' + col(bar(pct, 5)) + '▏ ' +
      col(Math.round(pct * 100) + '%')
    );
  }
  return colors.dim(label + ' ') + colors.gray(humanNumber(tokens));
}

async function main() {
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

  // Subscription windows — real API data only. No heuristic fallback.
  // If the API is unavailable, gauges are simply omitted; no estimated data shown.
  const apiUsage = await getUsage().catch(() => null);

  if (apiUsage && apiUsage.session5hPct !== null) {
    // Real data: render gauge directly from API percentage.
    const pct = apiUsage.session5hPct;
    const col = ratioColor(pct);
    parts.push(
      colors.dim('5h ') +
      '▕' + col(bar(pct, 5)) + '▏ ' +
      col(Math.round(pct * 100) + '%')
    );
  }
  // No real 5h API data — gauge omitted. No heuristic estimate displayed.

  if (apiUsage && apiUsage.weekly7dPct !== null) {
    // Real data: render gauge directly from API percentage.
    const pct = apiUsage.weekly7dPct;
    const col = ratioColor(pct);
    parts.push(
      colors.dim('7d ') +
      '▕' + col(bar(pct, 5)) + '▏ ' +
      col(Math.round(pct * 100) + '%')
    );
  }
  // No real 7d API data — gauge omitted. No heuristic estimate displayed.

  process.stdout.write(parts.join(colors.gray('  ·  ')));
}

main().catch(() => {
  // Fallback: if async main throws unexpectedly, render minimal output.
  process.stdout.write(colors ? colors.dim('token-watch error') : 'token-watch error');
});
