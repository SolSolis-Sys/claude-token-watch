'use strict';

/**
 * Tests for loop-advisor.js — issue #3 (API consumption) + issue #4 (hardcoded values).
 *
 * Issue #3: loop-advisor should factor in session cost (from transcript) so the
 *   advisory also reflects actual billing spend, not just the 5h quota gauge.
 *
 * Issue #4: hardcoded values — CACHE_FILE path must be imported from usage-api
 *   (single source of truth), and the 15-minute imminent threshold must be a
 *   named constant (exported or env-overridable).
 *
 * Run: node test/loop-advisor-cost.test.js
 */

const assert   = require('assert');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const { execSync } = require('child_process');

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + name);
}

const CACHE_DIR      = path.join(os.homedir(), '.claude', 'token-watch');
const CACHE_FILE     = path.join(CACHE_DIR, 'usage-cache.json');
const ADVISORY_FILE  = path.join(CACHE_DIR, 'loop-advisor-last.json');
const HOOK           = path.resolve(__dirname, '../hooks/loop-advisor.js');

/** Remove the cooldown sentinel so the next runHook() is never rate-limited. */
function clearAdvisoryCache() {
  try { fs.unlinkSync(ADVISORY_FILE); } catch { /* absent = ok */ }
}

/** Write a fake disk cache entry */
function writeCache(overrides) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const entry = Object.assign({
    data: {
      session5hPct: 0.85,
      weekly7dPct:  0.40,
      resetsSession: new Date(Date.now() + 32 * 60 * 1000).toISOString(),
      resetsWeekly: null,
    },
    fetchedAt: Date.now(),
    tlsInsecureOk: false,
    failCount: 0,
    nextRetryAt: 0,
  }, overrides);
  fs.writeFileSync(CACHE_FILE, JSON.stringify(entry));
}

/** Remove disk cache */
function clearCache() {
  try { fs.unlinkSync(CACHE_FILE); } catch { /* absent = ok */ }
}

/**
 * Write a minimal JSONL transcript with the given cost-producing messages.
 * Each entry in `usageRecords` is { input, output, model } — cost is computed
 * by the hook itself using lib/pricing.
 */
function writeTranscript(transcriptPath, usageRecords) {
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  const lines = usageRecords.map((r) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: {
        model: r.model || 'claude-sonnet-4-6',
        usage: {
          input_tokens:  r.input  || 0,
          output_tokens: r.output || 0,
        },
      },
    })
  );
  fs.writeFileSync(transcriptPath, lines.join('\n') + '\n');
}

/** Run the hook, optionally passing a transcript path via stdin JSON */
function runHook(env, stdinPayload) {
  const e = Object.assign({}, process.env, env);
  e.NO_COLOR = '1';
  const input = JSON.stringify(stdinPayload || {});
  try {
    const out = execSync(`node "${HOOK}"`, { input, env: e, encoding: 'utf8' });
    return { stdout: out, exitCode: 0 };
  } catch (err) {
    return { stdout: err.stdout || '', exitCode: err.status || 1 };
  }
}

/** Temp dir for transcript files in this test run */
const TMP_DIR = path.join(os.tmpdir(), 'tw-test-' + process.pid);
fs.mkdirSync(TMP_DIR, { recursive: true });

console.log('loop-advisor cost + constants tests\n');

// ── Issue #4 — CACHE_FILE is the canonical path from usage-api, not a copy ──

ok('usage-api exports CACHE_FILE that matches the path loop-advisor uses', () => {
  // If loop-advisor imports CACHE_FILE from usage-api, they must be the same.
  const { CACHE_FILE: apiCacheFile } = require('../lib/usage-api');
  assert.strictEqual(
    apiCacheFile,
    CACHE_FILE,
    'CACHE_FILE in usage-api must equal the path expected by loop-advisor'
  );
});

// ── Issue #4 — imminent threshold is a named constant (not magic "15") ───────

ok('hook respects TOKEN_WATCH_LOOP_IMMINENT_MINS to customise imminent window', () => {
  // With 20-minute imminent window and a reset in 18 minutes → imminent.
  clearAdvisoryCache();
  writeCache({
    data: {
      session5hPct: 0.90,
      weekly7dPct:  0.50,
      resetsSession: new Date(Date.now() + 18 * 60 * 1000).toISOString(),
      resetsWeekly: null,
    },
  });
  // Default (15 min): 18 min is NOT imminent.
  const defaultRun = runHook({});
  const defaultOut = JSON.parse(defaultRun.stdout);
  assert.ok(
    !defaultOut.systemMessage.includes('⛔'),
    'should NOT be imminent at 18min with default 15-min window'
  );

  // Custom (20 min): 18 min IS imminent — clear cooldown first.
  clearAdvisoryCache();
  const customRun = runHook({ TOKEN_WATCH_LOOP_IMMINENT_MINS: '20' });
  const customOut = JSON.parse(customRun.stdout);
  assert.ok(
    customOut.systemMessage.includes('⛔'),
    'should be imminent at 18min when TOKEN_WATCH_LOOP_IMMINENT_MINS=20'
  );
});

// ── Issue #3 — advisory includes session cost when transcript is available ───

ok('advisory includes session cost ($) when transcript is present', () => {
  clearAdvisoryCache();
  writeCache(); // 85%, 32 min reset
  const transcriptPath = path.join(TMP_DIR, 'session-cost.jsonl');
  // 1M input + 1M output at Sonnet = $18
  writeTranscript(transcriptPath, [
    { model: 'claude-sonnet-4-6', input: 1_000_000, output: 1_000_000 },
  ]);
  const { stdout } = runHook({}, { transcript_path: transcriptPath });
  const out = JSON.parse(stdout);
  // Cost should appear somewhere in the additionalContext
  assert.ok(
    out.hookSpecificOutput.additionalContext.includes('$'),
    'additionalContext should include a cost figure when transcript is available'
  );
});

ok('advisory cost figure is plausible (> $0 when tokens consumed)', () => {
  clearAdvisoryCache();
  writeCache();
  const transcriptPath = path.join(TMP_DIR, 'session-cost2.jsonl');
  // Small usage: 10k input + 1k output at Haiku ≈ $0.000015
  writeTranscript(transcriptPath, [
    { model: 'claude-haiku-4-5', input: 10_000, output: 1_000 },
  ]);
  const { stdout } = runHook({}, { transcript_path: transcriptPath });
  const out = JSON.parse(stdout);
  const ctx = out.hookSpecificOutput.additionalContext;
  // There should be a dollar amount > 0 in the advisory
  const match = ctx.match(/\$[\d.]+/);
  assert.ok(match, 'additionalContext should contain a $X.XX figure');
  const cost = parseFloat(match[0].slice(1));
  assert.ok(cost > 0, 'cost must be positive');
});

ok('advisory still fires when transcript is absent (cost omitted, no crash)', () => {
  clearAdvisoryCache();
  writeCache();
  const { stdout, exitCode } = runHook({}, { transcript_path: '/nonexistent/path.jsonl' });
  assert.strictEqual(exitCode, 0);
  const out = JSON.parse(stdout);
  assert.ok(out.hookSpecificOutput.additionalContext.includes('85%'), 'pct still present without transcript');
});

ok('advisory still fires when no stdin at all (transcript_path missing)', () => {
  clearAdvisoryCache();
  writeCache();
  const { stdout, exitCode } = runHook({});
  assert.strictEqual(exitCode, 0);
  const out = JSON.parse(stdout);
  assert.ok(out.hookSpecificOutput.additionalContext.includes('85%'));
});

// ── cleanup ──────────────────────────────────────────────────────────────────
clearCache();
clearAdvisoryCache();
try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}

console.log(`\n${passed} tests passed`);
