'use strict';

/**
 * Smoke tests for lib/cache-ttl.js
 *
 * Tests:
 *   1. cacheStatus(null) => null
 *   2. cacheStatus('/nonexistent/path.jsonl') => null
 *   3. Transcript with no cache events => null
 *   4. Transcript with recent 5m hit => { warm: true, type: '5m', pct ~1.0 }
 *   5. Transcript with expired 5m event (> 300s ago) => { warm: false, ... } or null
 *   6. Transcript with 1h write => { type: '1h', secondsLeft near 3600 }
 *   7. Transcript with missing timestamp => fallback file mtime, no crash
 *
 * Run: node test/cache-ttl.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const { cacheStatus } = require('../lib/cache-ttl');

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + name);
}

console.log('token-watch cache-ttl test\n');

// ── Helpers ──────────────────────────────────────────────────────────────────

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-cache-ttl-'));

function tmpFile(name, content) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

/** Build a single JSONL assistant line with specified usage fields and timestamp. */
function assistantLine(usageFields, timestamp) {
  const obj = {
    type: 'assistant',
    timestamp: timestamp || new Date().toISOString(),
    message: { model: 'claude-sonnet-4-6', usage: usageFields },
  };
  return JSON.stringify(obj);
}

// ── Test 1: null path => null ─────────────────────────────────────────────────

ok('cacheStatus(null) returns null', () => {
  assert.strictEqual(cacheStatus(null), null);
});

// ── Test 2: non-existent path => null ─────────────────────────────────────────

ok('cacheStatus(nonexistent path) returns null', () => {
  assert.strictEqual(cacheStatus('/nonexistent/tw-test-file-xyz.jsonl'), null);
});

// ── Test 3: transcript with no cache events => null ───────────────────────────

ok('transcript with no cache events returns null', () => {
  const content = [
    JSON.stringify({ type: 'human', message: { content: 'hello' } }),
    assistantLine({ input_tokens: 100, output_tokens: 50 }),
  ].join('\n');
  const f = tmpFile('no-cache.jsonl', content);
  assert.strictEqual(cacheStatus(f), null);
});

// ── Test 4: recent 5m hit => warm, pct near 1.0 ───────────────────────────────

ok('recent cache hit returns warm=true, type=5m, pct near 1.0', () => {
  // Event happened 5 seconds ago => ~295s left out of 300s => pct ~ 0.98
  const recentTs = new Date(Date.now() - 5000).toISOString();
  const content = [
    assistantLine({ input_tokens: 100, cache_read_input_tokens: 5000 }, recentTs),
  ].join('\n');
  const f = tmpFile('recent-hit.jsonl', content);
  const result = cacheStatus(f);
  assert.ok(result !== null, 'should not be null');
  assert.strictEqual(result.warm, true, 'warm should be true');
  assert.ok(result.secondsLeft > 290, 'secondsLeft should be close to 300');
  assert.ok(result.pct > 0.95, 'pct should be near 1.0');
  assert.strictEqual(result.type, '5m', 'type should be 5m');
});

// ── Test 5: expired 5m event (> 300s ago) => warm=false ───────────────────────

ok('expired cache event (>300s ago) returns warm=false', () => {
  // Event happened 400 seconds ago => elapsed > TTL => secondsLeft = 0
  const oldTs = new Date(Date.now() - 400_000).toISOString();
  const content = [
    assistantLine({ input_tokens: 100, cache_creation_input_tokens: 1000 }, oldTs),
  ].join('\n');
  const f = tmpFile('expired-hit.jsonl', content);
  const result = cacheStatus(f);
  // Either null or warm=false — both are acceptable
  if (result !== null) {
    assert.strictEqual(result.warm, false, 'warm should be false for expired cache');
    assert.strictEqual(result.secondsLeft, 0, 'secondsLeft should be 0 for expired cache');
  }
  // result === null is also acceptable behavior
});

// ── Test 6: 1h write => type=1h, secondsLeft near 3600 ────────────────────────

ok('1h write event returns type=1h and secondsLeft near 3600', () => {
  // Event happened 10 seconds ago => ~3590s left out of 3600s
  const recentTs = new Date(Date.now() - 10_000).toISOString();
  const content = [
    assistantLine({
      input_tokens: 500,
      cache_creation: {
        ephemeral_1h_input_tokens: 10000,
        ephemeral_5m_input_tokens: 0,
      },
    }, recentTs),
  ].join('\n');
  const f = tmpFile('write-1h.jsonl', content);
  const result = cacheStatus(f);
  assert.ok(result !== null, 'should not be null for 1h write');
  assert.strictEqual(result.warm, true, 'warm should be true');
  assert.strictEqual(result.type, '1h', 'type should be 1h');
  assert.ok(result.secondsLeft > 3580, 'secondsLeft should be near 3600');
  assert.ok(result.pct > 0.99, 'pct should be near 1.0');
});

// ── Test 7: missing timestamp => fallback file mtime, no crash ─────────────────

ok('missing timestamp falls back to file mtime without crashing', () => {
  // No timestamp field in the line
  const obj = {
    type: 'assistant',
    message: { model: 'claude-sonnet-4-6', usage: { cache_read_input_tokens: 1000 } },
  };
  const content = JSON.stringify(obj);
  const f = tmpFile('no-timestamp.jsonl', content);
  // Should not throw; may return null or a result depending on file mtime
  let result;
  assert.doesNotThrow(() => { result = cacheStatus(f); });
  // If result is not null, it should have correct shape
  if (result !== null) {
    assert.ok(typeof result.warm === 'boolean', 'warm should be boolean');
    assert.ok(typeof result.secondsLeft === 'number', 'secondsLeft should be number');
    assert.ok(typeof result.pct === 'number', 'pct should be number');
    assert.ok(result.type === '5m' || result.type === '1h', 'type should be 5m or 1h');
  }
});

// ── Cleanup ───────────────────────────────────────────────────────────────────

try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {
  // Non-fatal — temp dir cleanup failure doesn't fail tests
}

console.log('\n' + passed + ' checks passed.');
