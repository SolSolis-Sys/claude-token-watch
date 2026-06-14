'use strict';

/**
 * Claude model pricing — USD per million tokens (MTok).
 * Source: docs.claude.com pricing, June 2026.
 * Matching is done by substring on the model id so future point-releases
 * (e.g. claude-sonnet-4-7) inherit the right family automatically.
 */
const PRICING = {
  opus:   { input: 5,  output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
  sonnet: { input: 3,  output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6,  cacheRead: 0.3 },
  haiku:  { input: 1,  output: 5,  cacheWrite5m: 1.25, cacheWrite1h: 2,  cacheRead: 0.1 },
  // Fallback for unknown families — uses Sonnet-class rates so estimates stay sane.
  _default: { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3 },
};

/** Context window size (input tokens) per model family. */
const CONTEXT_WINDOW = {
  opus: 200000,
  sonnet: 200000,
  haiku: 200000,
  _default: 200000,
};

function family(modelId) {
  if (!modelId) return '_default';
  const m = String(modelId).toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return '_default';
}

function rates(modelId) {
  return PRICING[family(modelId)] || PRICING._default;
}

function contextWindow(modelId) {
  return CONTEXT_WINDOW[family(modelId)] || CONTEXT_WINDOW._default;
}

/**
 * Compute cost in USD for a single usage object.
 * usage = { input_tokens, output_tokens, cache_read_input_tokens,
 *           cache_creation: { ephemeral_5m_input_tokens, ephemeral_1h_input_tokens } }
 */
// Note: input_tokens from the Anthropic API excludes cache_read_input_tokens
// and cache_creation tokens — each is billed separately at its own rate, which
// is exactly how they are summed below. If totals ever diverge from the billing
// page, re-check this assumption against the current API docs.
function costOf(modelId, usage) {
  if (!usage) return 0;
  const r = rates(modelId);
  const inp = usage.input_tokens || 0;
  const out = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cc = usage.cache_creation || {};
  // Some transcripts only expose the flat cache_creation_input_tokens.
  const write5m = cc.ephemeral_5m_input_tokens || 0;
  const write1h = cc.ephemeral_1h_input_tokens || 0;
  const flatWrite = usage.cache_creation_input_tokens || 0;
  const writeKnown = write5m + write1h;
  // If only the flat value is present, bill it at the 5m cache-write rate.
  const writeFlatOnly = writeKnown === 0 ? flatWrite : 0;

  const per = (tokens, ratePerM) => (tokens / 1_000_000) * ratePerM;

  return (
    per(inp, r.input) +
    per(out, r.output) +
    per(cacheRead, r.cacheRead) +
    per(write5m, r.cacheWrite5m) +
    per(write1h, r.cacheWrite1h) +
    per(writeFlatOnly, r.cacheWrite5m)
  );
}

module.exports = { PRICING, CONTEXT_WINDOW, family, rates, contextWindow, costOf };
