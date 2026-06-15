'use strict';

/**
 * Claude model pricing — USD per million tokens (MTok).
 * Source: docs.anthropic.com/en/docs/about-claude/models, June 2026.
 *
 * Matching is done by substring on the model id, so future point-releases
 * (e.g. claude-sonnet-4-7) inherit the right family automatically.
 *
 * HOW TO ADD A MODEL
 * ------------------
 * Add an entry whose key is a unique substring of the model family id.
 * All fields are USD per million tokens:
 *   { input, output, cacheRead, cacheWrite5m, cacheWrite1h }
 * If cache tiers don't apply, set them to the same value as input.
 *
 * Example:
 *   'new-model-family': { input: 2, output: 10, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4 },
 */
const PRICING = {
  // ── Claude 4 Opus ─────────────────────────────────────────────────────────
  // Source: anthropic.com pricing page, June 2026
  // Opus 4.x (4.6/4.7/4.8): $5 input / $25 output (NOT the old Claude 3 Opus $15/$75)
  opus: {
    input: 5,
    output: 25,
    cacheRead: 0.5,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10,
  },

  // ── Claude 4 / 3.x Sonnet ─────────────────────────────────────────────────
  sonnet: {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6,
  },

  // ── Claude Haiku 4.5 ──────────────────────────────────────────────────────
  // $1 input / $5 output (NOT $0.80/$4)
  haiku: {
    input: 1,
    output: 5,
    cacheRead: 0.1,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2,
  },

  // ── Claude Fable 5 ────────────────────────────────────────────────────────
  // Source: anthropic.com pricing page, June 2026
  fable: {
    input: 10,
    output: 50,
    cacheRead: 1,
    cacheWrite5m: 12.5,
    cacheWrite1h: 20,
  },

  // ── Fallback ───────────────────────────────────────────────────────────────
  // Non-Claude models or unknown families fall back to Sonnet-class rates
  // so cost estimates stay sane without crashing.
  _default: {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6,
  },
};

/**
 * Context window size (input tokens) per model family.
 *
 * Models whose id contains "context-1m" or similar extended-context markers
 * are matched first and get a 1 000 000-token window.
 *
 * Override for any session via the TOKEN_WATCH_CONTEXT_WINDOW env variable.
 */
const CONTEXT_WINDOW = {
  // Extended-context variants (must be checked before the generic family match)
  'context-1m': 1_000_000,

  // Standard families — Opus/Sonnet/Fable = 1M, Haiku = 200k
  opus:    1_000_000,
  sonnet:  1_000_000,
  haiku:     200_000,
  fable:   1_000_000,
  _default:  200_000,
};

/**
 * Resolve the canonical family key for a model id.
 * Order matters: extended-context variants are checked first.
 */
function family(modelId) {
  if (!modelId) return '_default';
  const m = String(modelId).toLowerCase();
  // Extended-context variants first
  if (m.includes('context-1m')) return 'context-1m';
  if (m.includes('opus'))   return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku'))  return 'haiku';
  if (m.includes('fable'))  return 'fable';
  return '_default';
}

function rates(modelId) {
  const f = family(modelId);
  // Extended-context variants bill at their base family rate
  if (f === 'context-1m') return PRICING.sonnet;
  return PRICING[f] || PRICING._default;
}

/**
 * Return the context window size for a model.
 * Priority: TOKEN_WATCH_CONTEXT_WINDOW env > family table > 200k default.
 */
function contextWindow(modelId) {
  const envOverride = parseInt(process.env.TOKEN_WATCH_CONTEXT_WINDOW, 10);
  if (!isNaN(envOverride) && envOverride > 0) return envOverride;
  const f = family(modelId);
  return CONTEXT_WINDOW[f] || CONTEXT_WINDOW._default;
}

/**
 * Compute cost in USD for a single usage object.
 *
 * usage shape:
 *   {
 *     input_tokens,
 *     output_tokens,
 *     cache_read_input_tokens,
 *     cache_creation: {
 *       ephemeral_5m_input_tokens,  // 5-minute prompt cache
 *       ephemeral_1h_input_tokens,  // 1-hour prompt cache
 *     },
 *     cache_creation_input_tokens,  // flat fallback field (older transcripts)
 *   }
 *
 * NOTE: input_tokens from the Anthropic API excludes cache_read and
 * cache_creation tokens — each is billed separately. If totals diverge from
 * the billing page, re-check this assumption against the current API docs.
 */
function costOf(modelId, usage) {
  if (!usage) return 0;
  const r = rates(modelId);
  const inp      = usage.input_tokens || 0;
  const out      = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cc       = usage.cache_creation || {};
  const write5m  = cc.ephemeral_5m_input_tokens || 0;
  const write1h  = cc.ephemeral_1h_input_tokens || 0;
  const flatWrite = usage.cache_creation_input_tokens || 0;
  const writeKnown = write5m + write1h;
  // If only the flat value is present, bill it at the 5m cache-write rate.
  const writeFlatOnly = writeKnown === 0 ? flatWrite : 0;

  const per = (tokens, ratePerM) => (tokens / 1_000_000) * ratePerM;

  return (
    per(inp,           r.input) +
    per(out,           r.output) +
    per(cacheRead,     r.cacheRead) +
    per(write5m,       r.cacheWrite5m) +
    per(write1h,       r.cacheWrite1h) +
    per(writeFlatOnly, r.cacheWrite5m)
  );
}

module.exports = { PRICING, CONTEXT_WINDOW, family, rates, contextWindow, costOf };
