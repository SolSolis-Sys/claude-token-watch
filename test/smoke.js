'use strict';

/**
 * Zero-framework smoke test. Exercises the pure logic against synthetic
 * usage and asserts the cost math, the parser, and the formatters.
 * Run: node test/smoke.js
 */

const assert = require('assert');
const { costOf, family, contextWindow } = require('../lib/pricing');
const { aggregate } = require('../lib/transcript');
const { humanNumber, usd, bar } = require('../lib/format');

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + name);
}

console.log('token-watch smoke test\n');

ok('family() matches by substring', () => {
  assert.strictEqual(family('claude-opus-4-8'), 'opus');
  assert.strictEqual(family('claude-sonnet-4-6'), 'sonnet');
  assert.strictEqual(family('claude-haiku-4-5'), 'haiku');
  assert.strictEqual(family('something-new'), '_default');
});

ok('contextWindow() defaults to 200k', () => {
  assert.strictEqual(contextWindow('claude-sonnet-4-6'), 200000);
});

ok('costOf() bills input/output at Sonnet rates', () => {
  // 1M input @ $3 + 1M output @ $15 = $18 exactly.
  const c = costOf('claude-sonnet-4-6', { input_tokens: 1_000_000, output_tokens: 1_000_000 });
  assert.ok(Math.abs(c - 18) < 1e-9, 'expected 18, got ' + c);
});

ok('costOf() bills cache read + 1h write', () => {
  // 1M cache read @ $0.30 + 1M 1h write @ $6 = $6.30
  const c = costOf('claude-sonnet-4-6', {
    cache_read_input_tokens: 1_000_000,
    cache_creation: { ephemeral_1h_input_tokens: 1_000_000, ephemeral_5m_input_tokens: 0 },
  });
  assert.ok(Math.abs(c - 6.3) < 1e-9, 'expected 6.30, got ' + c);
});

ok('costOf() handles flat cache_creation_input_tokens', () => {
  // Falls back to 5m write rate ($3.75) when only the flat field is present.
  const c = costOf('claude-sonnet-4-6', { cache_creation_input_tokens: 1_000_000 });
  assert.ok(Math.abs(c - 3.75) < 1e-9, 'expected 3.75, got ' + c);
});

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
