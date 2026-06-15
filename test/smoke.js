'use strict';

/**
 * Zero-framework smoke test. Exercises the pure logic against synthetic
 * usage and asserts the cost math, the parser, and the formatters.
 * Run: node test/smoke.js
 */

const assert = require('assert');
const { costOf, family, contextWindow, PRICING } = require('../lib/pricing');
const { aggregate } = require('../lib/transcript');
const { humanNumber, usd, bar } = require('../lib/format');

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + name);
}

console.log('token-watch smoke test\n');

// ── Family matching ──────────────────────────────────────────────────────────

ok('family() matches opus', () => {
  assert.strictEqual(family('claude-opus-4-8'), 'opus');
  assert.strictEqual(family('claude-opus-4'), 'opus');
});

ok('family() matches sonnet', () => {
  assert.strictEqual(family('claude-sonnet-4-6'), 'sonnet');
  assert.strictEqual(family('claude-sonnet-4-7'), 'sonnet');
});

ok('family() matches haiku', () => {
  assert.strictEqual(family('claude-haiku-4-5'), 'haiku');
});

ok('family() matches fable', () => {
  assert.strictEqual(family('claude-fable-5'), 'fable');
});

ok('family() matches context-1m extended variant', () => {
  assert.strictEqual(family('claude-sonnet-4-context-1m'), 'context-1m');
});

ok('family() falls back to _default for unknown', () => {
  assert.strictEqual(family('something-new'), '_default');
  assert.strictEqual(family(''), '_default');
  assert.strictEqual(family(null), '_default');
});

// ── Pricing completeness ─────────────────────────────────────────────────────

ok('PRICING has all expected families', () => {
  for (const key of ['opus', 'sonnet', 'haiku', 'fable', '_default']) {
    assert.ok(PRICING[key], 'missing pricing entry for ' + key);
    assert.ok(typeof PRICING[key].input === 'number', key + '.input must be a number');
    assert.ok(typeof PRICING[key].output === 'number', key + '.output must be a number');
    assert.ok(typeof PRICING[key].cacheRead === 'number', key + '.cacheRead must be a number');
    assert.ok(typeof PRICING[key].cacheWrite5m === 'number', key + '.cacheWrite5m must be a number');
    assert.ok(typeof PRICING[key].cacheWrite1h === 'number', key + '.cacheWrite1h must be a number');
  }
});

ok('Opus rates are higher than Sonnet rates', () => {
  assert.ok(PRICING.opus.input > PRICING.sonnet.input, 'opus input should cost more');
  assert.ok(PRICING.opus.output > PRICING.sonnet.output, 'opus output should cost more');
});

ok('Haiku rates are lower than Sonnet rates', () => {
  assert.ok(PRICING.haiku.input < PRICING.sonnet.input, 'haiku input should cost less');
  assert.ok(PRICING.haiku.output < PRICING.sonnet.output, 'haiku output should cost less');
});

// ── Context window ───────────────────────────────────────────────────────────

ok('contextWindow() returns per-family values', () => {
  // Sonnet and Opus = 1M context
  assert.strictEqual(contextWindow('claude-sonnet-4-6'), 1_000_000);
  assert.strictEqual(contextWindow('claude-opus-4'), 1_000_000);
  // Haiku = 200k context
  assert.strictEqual(contextWindow('claude-haiku-4-5'), 200_000);
});

ok('contextWindow() returns 1M for context-1m variants', () => {
  assert.strictEqual(contextWindow('claude-sonnet-4-context-1m'), 1_000_000);
});

ok('contextWindow() respects TOKEN_WATCH_CONTEXT_WINDOW env override', () => {
  const orig = process.env.TOKEN_WATCH_CONTEXT_WINDOW;
  process.env.TOKEN_WATCH_CONTEXT_WINDOW = '500000';
  assert.strictEqual(contextWindow('claude-sonnet-4-6'), 500_000);
  if (orig === undefined) delete process.env.TOKEN_WATCH_CONTEXT_WINDOW;
  else process.env.TOKEN_WATCH_CONTEXT_WINDOW = orig;
});

// ── Cost math ────────────────────────────────────────────────────────────────

ok('costOf() bills input/output at Sonnet rates', () => {
  // 1M input @ $3 + 1M output @ $15 = $18 exactly.
  const c = costOf('claude-sonnet-4-6', { input_tokens: 1_000_000, output_tokens: 1_000_000 });
  assert.ok(Math.abs(c - 18) < 1e-9, 'expected 18, got ' + c);
});

ok('costOf() bills cache read + 1h write at Sonnet rates', () => {
  // 1M cache read @ $0.30 + 1M 1h write @ $6 = $6.30
  const c = costOf('claude-sonnet-4-6', {
    cache_read_input_tokens: 1_000_000,
    cache_creation: { ephemeral_1h_input_tokens: 1_000_000, ephemeral_5m_input_tokens: 0 },
  });
  assert.ok(Math.abs(c - 6.3) < 1e-9, 'expected 6.30, got ' + c);
});

ok('costOf() handles flat cache_creation_input_tokens (5m fallback)', () => {
  // Falls back to 5m write rate ($3.75) when only the flat field is present.
  const c = costOf('claude-sonnet-4-6', { cache_creation_input_tokens: 1_000_000 });
  assert.ok(Math.abs(c - 3.75) < 1e-9, 'expected 3.75, got ' + c);
});

ok('costOf() bills Haiku correctly', () => {
  // 1M input @ $1.00 + 1M output @ $5.00 = $6.00
  const c = costOf('claude-haiku-4-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 });
  assert.ok(Math.abs(c - 6) < 1e-9, 'expected 6.00, got ' + c);
});

ok('costOf() bills Opus correctly', () => {
  // 1M input @ $5.00 + 1M output @ $25.00 = $30.00
  const c = costOf('claude-opus-4', { input_tokens: 1_000_000, output_tokens: 1_000_000 });
  assert.ok(Math.abs(c - 30) < 1e-9, 'expected 30.00, got ' + c);
});

ok('costOf() returns 0 for null/missing usage', () => {
  assert.strictEqual(costOf('claude-sonnet-4-6', null), 0);
  assert.strictEqual(costOf('claude-sonnet-4-6', undefined), 0);
  assert.strictEqual(costOf('claude-sonnet-4-6', {}), 0);
});

// ── Aggregate ────────────────────────────────────────────────────────────────

ok('aggregate() sums records', () => {
  const t = aggregate([
    { input: 10, output: 5, cacheRead: 1, cacheWrite: 2, cost: 0.5, model: 'claude-sonnet-4-6' },
    { input: 20, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.25, model: 'claude-haiku-4-5' },
  ]);
  assert.strictEqual(t.input, 30);
  assert.strictEqual(t.output, 10);
  assert.strictEqual(t.messages, 2);
  assert.ok(Math.abs(t.cost - 0.75) < 1e-9);
});

// ── Subscription window buckets ──────────────────────────────────────────────

ok('rolling window bucket: sessions within 5h are included', () => {
  const now = Date.now();
  const sessions = [
    { ts: new Date(now - 1 * 3600_000).toISOString(), input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.001, messages: 1 },
    { ts: new Date(now - 6 * 3600_000).toISOString(), input: 999, output: 999, cacheRead: 0, cacheWrite: 0, cost: 9.99, messages: 10 },
  ];
  const cutoff5h = now - 5 * 3600_000;
  const included = sessions.filter(s => new Date(s.ts).getTime() >= cutoff5h);
  assert.strictEqual(included.length, 1);
  assert.strictEqual(included[0].input, 100);
});

ok('rolling window bucket: sessions within 7d are included', () => {
  const now = Date.now();
  const sessions = [
    { ts: new Date(now - 1 * 86400_000).toISOString(), input: 200, output: 100, cacheRead: 0, cacheWrite: 0, cost: 0.01, messages: 2 },
    { ts: new Date(now - 8 * 86400_000).toISOString(), input: 999, output: 999, cacheRead: 0, cacheWrite: 0, cost: 9.99, messages: 5 },
  ];
  const cutoff7d = now - 7 * 86400_000;
  const included = sessions.filter(s => new Date(s.ts).getTime() >= cutoff7d);
  assert.strictEqual(included.length, 1);
  assert.strictEqual(included[0].input, 200);
});

// ── Subscription caps resolution ─────────────────────────────────────────────

const { computeCaps, PLANS, tierToPlan } = require('../lib/subscription');

ok('tierToPlan() maps Max 20x / 5x / Pro tiers', () => {
  assert.strictEqual(tierToPlan('{"subscriptionType":"max_20x"}'), 'max20');
  assert.strictEqual(tierToPlan('Claude Max 20x'), 'max20');
  assert.strictEqual(tierToPlan('{"tier":"max_5x"}'), 'max5');
  assert.strictEqual(tierToPlan('Max 5x'), 'max5');
  assert.strictEqual(tierToPlan('max'), 'max5');
  assert.strictEqual(tierToPlan('Claude Pro'), 'pro');
  assert.strictEqual(tierToPlan('free'), null);
  assert.strictEqual(tierToPlan(''), null);
  assert.strictEqual(tierToPlan(null), null);
});

ok('computeCaps() returns no caps when nothing configured', () => {
  const c = computeCaps({});
  assert.strictEqual(c.plan, null);
  assert.strictEqual(c.session5h, 0);
  assert.strictEqual(c.weekly, 0);
});

ok('computeCaps() applies env plan presets', () => {
  const c = computeCaps({ envPlan: 'max5' });
  assert.strictEqual(c.plan, 'max5');
  assert.strictEqual(c.session5h, PLANS.max5.session5h);
  assert.strictEqual(c.weekly, PLANS.max5.weekly);
});

ok('computeCaps() applies auto-detected (cached) plan when no env plan', () => {
  const c = computeCaps({ cachedPlan: 'pro' });
  assert.strictEqual(c.plan, 'pro');
  assert.strictEqual(c.session5h, PLANS.pro.session5h);
});

ok('computeCaps() env plan overrides cached plan', () => {
  const c = computeCaps({ envPlan: 'max20', cachedPlan: 'pro' });
  assert.strictEqual(c.plan, 'max20');
});

ok('computeCaps() env caps override the plan preset', () => {
  const c = computeCaps({ envPlan: 'pro', envSession: 12345, envWeekly: 67890 });
  assert.strictEqual(c.session5h, 12345);
  assert.strictEqual(c.weekly, 67890);
});

ok('computeCaps() ignores unknown plan but honors env caps', () => {
  const c = computeCaps({ envPlan: 'bogus', envSession: 500 });
  assert.strictEqual(c.plan, null);
  assert.strictEqual(c.session5h, 500);
  assert.strictEqual(c.weekly, 0);
});

ok('PLANS scale with tier (max20 > max5 > pro)', () => {
  assert.ok(PLANS.max20.session5h > PLANS.max5.session5h);
  assert.ok(PLANS.max5.session5h > PLANS.pro.session5h);
  assert.ok(PLANS.max20.weekly > PLANS.pro.weekly);
});

// ── Formatters ───────────────────────────────────────────────────────────────

ok('humanNumber() compacts', () => {
  assert.strictEqual(humanNumber(950), '950');
  assert.strictEqual(humanNumber(1500), '1.5k');
  assert.strictEqual(humanNumber(2_500_000), '2.5M');
});

ok('usd() formats', () => {
  assert.strictEqual(usd(12.5), '$12.50');
  assert.strictEqual(usd(0.004), '$0.0040');
});

ok('bar() clamps and sizes', () => {
  assert.strictEqual(bar(0, 4), '░░░░');
  assert.strictEqual(bar(1, 4), '████');
  assert.strictEqual(bar(0.5, 4).length, 4);
});

console.log('\n' + passed + ' checks passed.');
